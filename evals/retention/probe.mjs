import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';

export const config = Object.freeze({ batches: 24, outputsPerBatch: 64, warmupBatches: 6, payloadSlots: 8 });
export const shapes = ['primitive', 'primitive-object', 'object-primitive', 'stable-object-primitive'];

export function trend(samples) {
  assert(samples.length >= 3 && samples.every(Number.isFinite), 'three finite samples required');
  const center = (samples.length - 1) / 2;
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return samples.reduce((sum, value, i) => sum + (i - center) * (value - mean), 0)
    / samples.reduce((sum, _, i) => sum + (i - center) ** 2, 0);
}

export function summarize(samples) {
  return { samples, slopeBytesPerBatch: trend(samples), growthBytes: samples.at(-1) - samples[0] };
}

export async function collectHeap() {
  assert.equal(typeof globalThis.gc, 'function', 'probe requires --expose-gc');
  for (let i = 0; i < 3; i++) { await nextTurn(); globalThis.gc(); }
  return process.memoryUsage().heapUsed;
}

export function createFixture(StreamingStore, shape, retained = null) {
  assert(shapes.includes(shape), 'unknown argument shape');
  const initialState = { value: 1 };
  const reducer = Object.assign((state = initialState) => state, { initialState });
  const store = new StreamingStore({ retention: reducer });
  try {
    store.init();
    const fixture = { store, shape, stable: { payload: Array(config.payloadSlots).fill(1) },
      select: null, deliveries: 0, checksum: 0 };
    fixture.select = store.createSelector((state, first, second) => {
      const id = typeof first === 'number' ? first : second;
      const argument = typeof first === 'number' ? second : first;
      if (retained) retained.push(Array(256).fill(id));
      return state.retention.value + id + (typeof argument === 'number' ? argument : argument.payload[0]);
    });
    return fixture;
  } catch (error) { store.dispose(); throw error; }
}

export function argsFor(fixture, id) {
  if (fixture.shape === 'primitive') return [id, 1];
  const argument = fixture.shape === 'stable-object-primitive'
    ? fixture.stable : { payload: Array(config.payloadSlots).fill(1) };
  return fixture.shape === 'primitive-object' ? [id, argument] : [argument, id];
}

export function churn(fixture, policy, batch, count = config.outputsPerBatch) {
  assert(['unique', 'reused'].includes(policy), 'unknown key policy');
  const before = fixture.deliveries;
  for (let i = 0; i < count; i++) {
    const id = policy === 'unique' ? batch * count + i : 0;
    const args = argsFor(fixture, id);
    const output = fixture.select(...args);
    const subscription = output.observe((value) => {
      assert.equal(value, id + 2);
      fixture.deliveries++;
      fixture.checksum += value;
    });
    try { assert.equal(fixture.select(...args), output, 'active identity changed'); }
    finally { subscription.unsubscribe(); }
  }
  assert.equal(fixture.deliveries - before, count, 'one initial emission per subscription');
}

export function dispose(fixture) {
  fixture?.store?.dispose();
  if (fixture) { fixture.store = null; fixture.select = null; fixture.stable = null; }
}

export async function measure(StreamingStore, shape, policy, inject = false, collect = collectHeap) {
  const retained = inject ? [] : null;
  let fixture = null;
  try {
    fixture = createFixture(StreamingStore, shape);
    for (let i = 0; i < config.warmupBatches; i++) { churn(fixture, policy, i); await collect(); }
    dispose(fixture);
    fixture = createFixture(StreamingStore, shape, retained);
    const baseline = await collect();
    const live = [];
    for (let batch = 0; batch < config.batches; batch++) {
      churn(fixture, policy, batch);
      live.push(await collect() - baseline);
    }
    const deliveries = fixture.deliveries;
    const checksum = fixture.checksum;
    dispose(fixture);
    fixture = null;
    const afterLiveDisposeBytes = await collect() - baseline;
    for (let batch = 0; batch < config.warmupBatches; batch++) {
      fixture = createFixture(StreamingStore, shape);
      churn(fixture, policy, batch);
      dispose(fixture);
      fixture = null;
      await collect();
    }
    const disposalBaseline = await collect();
    const disposed = [];
    for (let batch = 0; batch < config.batches; batch++) {
      fixture = createFixture(StreamingStore, shape, retained);
      churn(fixture, policy, batch);
      dispose(fixture);
      fixture = null;
      disposed.push(await collect() - disposalBaseline);
    }
    return { shape, policy, inject, deliveries, checksum, live: summarize(live),
      afterLiveDisposeBytes, disposed: summarize(disposed), retainedArrays: retained?.length ?? 0 };
  } finally { dispose(fixture); if (retained) retained.length = 0; }
}

function subscribeWeakFixture(StreamingStore) {
  const fixture = createFixture(StreamingStore, 'primitive-object');
  const args = argsFor(fixture, 1);
  const output = fixture.select(...args);
  const subscription = output.observe(() => {});
  const refs = [output, args, args[1], args[1].payload, subscription].map((value) => new WeakRef(value));
  subscription.unsubscribe();
  return { fixture, refs, ownerRefs: [new WeakRef(fixture.store), new WeakRef(fixture.select)] };
}

export async function verifyReferenceRelease(StreamingStore) {
  let { fixture, refs, ownerRefs } = subscribeWeakFixture(StreamingStore);
  await collectHeap();
  assert(refs.every((ref) => ref.deref() === undefined), 'released output/args/payload/subscription retained');
  assert(ownerRefs.every((ref) => ref.deref() !== undefined), 'store/selector should remain live');
  dispose(fixture);
  fixture = null;
  await collectHeap();
  assert(ownerRefs.every((ref) => ref.deref() === undefined), 'disposed owner retained');
  return { releasedObjectsCollected: refs.length, disposedOwnersCollected: ownerRefs.length };
}