import { describe, expect, it, vi } from 'vitest';
import { argsFor, churn, collectHeap, config, createFixture, dispose, measure, summarize, trend } from './probe.mjs';
import { checkSensitivity } from './run.mjs';

class FakeStore {
  disposed = false;
  init() {}
  dispose() { this.disposed = true; }
  createSelector(callback: (...args: any[]) => number) {
    let cached: any;
    return (...args: any[]) => cached ??= {
      observe(listener: (value: number) => void) {
        listener(callback({ retention: { value: 1 } }, ...args));
        return { unsubscribe() { cached = undefined; } };
      },
    };
  }
}

describe('bounded retention measurement helpers', () => {
  it('preserves signed slopes and raw samples', () => {
    expect(trend([10, 20, 30, 40])).toBe(10);
    expect(trend([40, 30, 20, 10])).toBe(-10);
    expect(summarize([3, 3, 3])).toEqual({ samples: [3, 3, 3], slopeBytesPerBatch: 0, growthBytes: 0 });
    expect(() => trend([1, 2])).toThrow();
    expect(() => trend([1, NaN, 3])).toThrow();
  });

  it.each(['primitive', 'primitive-object', 'object-primitive', 'stable-object-primitive'])('checks %s values and releases subscriptions', (shape) => {
    const fixture = createFixture(FakeStore, shape);
    try {
      churn(fixture, 'unique', 0, 4);
      churn(fixture, 'reused', 1, 4);
      expect(fixture.deliveries).toBe(8);
      expect(fixture.checksum).toBe(22);
      const args = argsFor(fixture, 123);
      expect(args[shape.endsWith('object-primitive') ? 1 : 0]).toBe(123);
    } finally { dispose(fixture); }
    expect(fixture.store).toBeNull();
    expect(fixture.select).toBeNull();
    expect(fixture.stable).toBeNull();
  });

  it.each([-100, 0, 32768])('preserves injected sampler trend %s separately in each phase', async (growth) => {
    const samples = Array(config.warmupBatches + 1).fill(1_000_000);
    for (let i = 0; i < config.batches; i++) samples.push(1_000_000 + i * growth);
    samples.push(...Array(config.warmupBatches + 2).fill(1_000_000));
    for (let i = 0; i < config.batches; i++) samples.push(1_000_000 + i * growth);
    const result = await measure(FakeStore, 'primitive', 'unique', false, async () => samples.shift());
    expect(samples).toHaveLength(0);
    expect(result.live.slopeBytesPerBatch).toBe(growth);
    expect(result.disposed.slopeBytesPerBatch).toBe(growth);
    expect(result.live.growthBytes).toBe(23 * growth);
    expect(result.deliveries).toBe(1536);
  });

  it('rejects a missing GC rather than silently passing', async () => {
    vi.stubGlobal('gc', undefined);
    try { await expect(collectHeap()).rejects.toThrow(/expose-gc/); }
    finally { vi.unstubAllGlobals(); }
  });

  it('disposes a partially sampled fixture on failure', async () => {
    const cleanup = vi.spyOn(FakeStore.prototype, 'dispose');
    try {
      await expect(measure(FakeStore, 'primitive', 'unique', false, async () => { throw Error('sample'); })).rejects.toThrow('sample');
      expect(cleanup).toHaveBeenCalledOnce();
    } finally { cleanup.mockRestore(); }
  });

  it('rejects an insensitive metric and requires sensitivity in both phases', () => {
    const row = (live: number, disposed: number) => ({ live: { slopeBytesPerBatch: live }, disposed: { slopeBytesPerBatch: disposed } });
    expect(() => checkSensitivity(row(0, 0), row(0, 0))).toThrow();
    expect(() => checkSensitivity(row(0, 0), row(200_000, 0))).toThrow();
    expect(checkSensitivity(row(0, 0), row(200_000, 200_000)).liveDelta).toBe(200_000);
  });
});