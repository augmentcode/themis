import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { buffers, channel } from 'redux-saga';
import { take } from 'typed-redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamingStore } from './streaming-store';
import type { StoreOptions } from './types';

// Execute the actual Markdown fence, substituting only app-owned imports/inputs.
function example(skill: string, heading: string, result: string, inputs: Record<string, unknown> = {}, modules: Record<string, unknown> = {}) {
  const markdown = readFileSync(new URL(`../skills/core/${skill}/SKILL.md`, import.meta.url), 'utf8');
  const section = markdown.split(heading)[1]?.split(/\n#{1,3} /)[0];
  const code = section?.match(/```(?:ts|typescript|js)\n([\s\S]*?)```/)?.[1];
  if (!code) throw new Error(`Missing executable example: ${skill}: ${heading}`);
  const javascript = transpileModule(code, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const requireExample = (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected example import: ${name}`);
    return modules[name];
  };
  return new Function('require', 'exports', ...Object.keys(inputs), `${javascript}\nreturn ${result};`)(requireExample, {}, ...Object.values(inputs));
}

const stores: StreamingStore[] = [];
function createStore(options: StoreOptions = {}) {
  const store = new StreamingStore(undefined, undefined, options);
  stores.push(store);
  return store;
}

afterEach(() => {
  stores.splice(0).forEach((store) => store.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Core guidance executable examples', () => {
  it('retains more than ten default messages and enforces each explicit bounded overflow policy', () => {
    const queues = example('redux-saga', '### 4. Channels, buffers, and cleanup',
      '({ defaultQueue, recentQueue, firstQueue, strictQueue })', {}, { 'redux-saga': { buffers, channel } });
    try {
      for (let value = 0; value < 25; value++) {
        queues.defaultQueue.put(value);
        queues.recentQueue.put(value);
        queues.firstQueue.put(value);
      }
      const flush = (queue: ReturnType<typeof channel>) => { let values; queue.flush((items) => { values = items; }); return values; };
      expect(flush(queues.defaultQueue)).toEqual(Array.from({ length: 25 }, (_, i) => i));
      expect(flush(queues.recentQueue)).toEqual(Array.from({ length: 10 }, (_, i) => i + 15));
      expect(flush(queues.firstQueue)).toEqual(Array.from({ length: 10 }, (_, i) => i));
      for (let value = 0; value < 10; value++) queues.strictQueue.put(value);
      expect(() => queues.strictQueue.put(10)).toThrow(/overflow/i);
      expect(flush(queues.strictQueue)).toEqual(Array.from({ length: 10 }, (_, i) => i));
    } finally {
      Object.values(queues).forEach((queue: any) => queue.close());
    }
  });

  it('starts the imported saga only at its owner boundary and stops it before disposing its Store', () => {
    const store = createStore();
    const handled = vi.fn();
    const cancelled = vi.fn();
    const stopped = vi.fn();
    const runSaga = store.runSaga.bind(store);
    vi.spyOn(store, 'runSaga').mockImplementation((saga) => {
      const stop = runSaga(saga);
      return () => { stopped(); stop(); };
    });
    const dispose = vi.spyOn(store, 'dispose');
    function* jobsSaga() {
      try { while (true) { yield* take('jobs/load'); handled(); } }
      finally { cancelled(); }
    }
    const startJobsOwner = example('import-boundaries', '### Bootstrap and lifetime-owner exception', 'startJobsOwner', {}, {
      '$lib/store': { store }, '$lib/store/slices/jobs/sagas/jobs-saga': { jobsSaga },
    });
    expect(() => store.runSaga(jobsSaga)).toThrow(/before Store.init/);
    const stopOwner = startJobsOwner();
    expect(cancelled).not.toHaveBeenCalled();
    store.dispatch({ type: 'jobs/load' });
    expect(handled).toHaveBeenCalledTimes(1);
    stopOwner();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(stopped.mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0]);
    expect(() => store.state).toThrow(/before Store.init/);
  });

  it('pairs an owner stop handle without disposing a Store owned by a longer-lived parent', () => {
    const store = createStore();
    store.init();
    const stopped = vi.fn();
    function* jobsSaga() { try { yield* take('jobs/done'); } finally { stopped(); } }
    const stop = store.runSaga(jobsSaga);
    stop();
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(() => store.dispatch({ type: 'jobs/still-usable' })).not.toThrow();
  });

  it.each([true, false])('custom logger leaves runtime-owned aggregates controlled by summaryEnabled=%s', (summaryEnabled) => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const group = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    const reportRuntimeError = vi.fn();
    const options = example('redux-action-logging', '## Logger factory lifecycle', 'options', { reportRuntimeError });
    if (!summaryEnabled) options.traceSelectors.summaryEnabled = false;
    const store = createStore(options);
    store.init();
    store.dispatch({ type: 'test/logged-action' });
    store.getSelectorTraceReporter()?.({
      selectorFunc: (state: { count: number }) => state.count,
      executionDurationMs: 2, recomputationCount: 1, invalidationReason: 'first-execution', resultOutcome: 'initial',
    });
    expect(group).not.toHaveBeenCalled();
    vi.advanceTimersByTime(options.traceSelectors.summaryIntervalMs);
    expect(info).toHaveBeenCalledTimes(summaryEnabled ? 1 : 0);
    if (summaryEnabled) expect(info.mock.calls[0][0]).toBe('[themis] selectors fired: 1, recalculated: 1');
    vi.advanceTimersByTime(options.traceSelectors.summaryIntervalMs);
    expect(info).toHaveBeenCalledTimes(summaryEnabled ? 1 : 0);
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('custom logger example unsubscribes on disposal and reattaches once on reinitialization', () => {
    const unsubscribe = vi.fn();
    const observe = vi.fn(() => ({ unsubscribe }));
    const reportRuntimeError = vi.fn();
    const options = example('redux-action-logging', '## Logger factory lifecycle', 'options', { reportRuntimeError });
    const factory = options.loggerFactory;
    options.traceSelectors.summaryEnabled = false;
    options.loggerFactory = () => factory({ runtimeError: { observe } });
    const store = createStore(options);
    store.init(); store.init();
    expect(observe).toHaveBeenCalledExactlyOnceWith(reportRuntimeError);
    store.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    store.init(); store.dispose();
    expect(observe).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('diagnoses registrations, not init counts, and handles single, multiple, empty and missing contexts', () => {
    const browser: any = {};
    vi.stubGlobal('window', browser);
    const inspect = () => example('debugging', '### Expecting `reduxContext` to always be an object', 'states');
    expect(inspect()).toEqual([]);
    const runtimeError = vi.fn();
    const loggerFactory = (streams: any) => { const sub = streams.runtimeError.observe(runtimeError); return () => sub.unsubscribe(); };
    const first = createStore({ loggerFactory });
    const second = createStore({ loggerFactory });
    first.init(); first.init(); second.init();
    expect(browser.svelteRedux).toBeUndefined();
    first.initDevTool(); first.initDevTool();
    expect(runtimeError).not.toHaveBeenCalled();
    expect(inspect()).toEqual([first.state]);
    second.initDevTool();
    expect(runtimeError).toHaveBeenCalledWith(expect.objectContaining({ source: 'global-dev-tools', message: 'Multiple Redux stores initialized:' }));
    expect(browser.svelteRedux.reduxContext.state).toBeUndefined();
    expect(inspect()).toEqual([first.state, second.state]);
    first.dispose();
    expect(inspect()).toEqual([second.state]);
    second.dispose();
    expect(inspect()).toEqual([]);
  });
});