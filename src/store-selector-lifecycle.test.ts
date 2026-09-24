import { signal, type ReadonlySignal } from '@preact/signals-react';
import type { Observable } from 'kefir';
import { writable, type Readable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from './react-store';
import { Store } from './svelte-store';
import { StreamingStore } from './streaming-store';
import { lockUpdates, unlockUpdates } from './slices/store-utility/store-utility-slice';
import { createKefirPropertyFromSubscribe } from './utils/selector-core/kefir-selector';
import type { StoreOptions } from './types';

vi.mock('./utils/runtime-svelte/utils', () => ({
  getStoreContext: vi.fn(() => undefined),
  getDispatch: vi.fn(),
}));

const counterReducer = Object.assign(
  (state = { count: 0 }, action: { type: string; payload?: number }) =>
    action.type === 'counter/set' ? { count: action.payload! } : state,
  { initialState: { count: 0 } }
);
const adapters = [
  { name: 'React', create: (options: StoreOptions) => new ReactStore({ counter: counterReducer }, undefined, options) },
  { name: 'Svelte', create: (options: StoreOptions) => new Store({ counter: counterReducer }, undefined, options) },
  { name: 'Streaming', create: (options: StoreOptions) => new StreamingStore({ counter: counterReducer }, undefined, options) },
];
type AdapterStore = ReturnType<(typeof adapters)[number]['create']>;
type Output<T> = ReadonlySignal<T> | Readable<T> | Observable<T, any>;
type Key = string | { id: string };

const observe = <T>(output: Output<T>, listener: (value: T) => void): (() => void) => {
  if ('observe' in output) {
    const subscription = output.observe(listener);
    return () => subscription.unsubscribe();
  }
  return output.subscribe(listener);
};

const reactiveFixture = (store: AdapterStore) => {
  const select = (state: { counter: { count: number } }, _label: string, factor: number) =>
    state.counter.count * factor;
  if (store instanceof ReactStore) {
    const argument = signal(2);
    const selector = store.createSelector(select);
    return { get: () => selector('shared', argument), churn: (key: string) => selector(key, 2), set: (n: number) => { argument.value = n; } };
  }
  const argument = writable(2);
  if (store instanceof Store) {
    const selector = store.createSelector(select);
    return { get: () => selector('shared', argument), churn: (key: string) => selector(key, 2), set: argument.set };
  }
  let current = 2;
  const property = createKefirPropertyFromSubscribe(() => current, argument.subscribe);
  const selector = store.createSelector(select);
  return {
    get: () => selector('shared', property), churn: (key: string) => selector(key, 2),
    set: (n: number) => { current = n; argument.set(n); },
  };
};

describe.each(adapters)('$name selector cache lifecycle', ({ create }) => {
  let store: AdapterStore;
  const cleanups: Array<() => void> = [];
  const watch = <T>(output: Output<T>, values: T[] = []) => {
    const cleanup = observe(output, (value) => values.push(value));
    cleanups.push(cleanup);
    return cleanup;
  };
  const setCount = (count: number) => store.dispatch({ type: 'counter/set', payload: count });
  const flush = () => vi.advanceTimersByTime(100);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
    store = create({ throttledSelectorFrequency: 10, loggerFactory: () => undefined });
    store.init({ counter: { count: 1 } });
  });

  afterEach(() => {
    cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
    store.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['primitive', 'primitive-object', 'object-primitive'] as const)(
    'preserves shared %s outputs through partial release, churn and stale reactivation cleanup',
    (shape) => {
      const object = { id: 'stable' };
      const args = (key: string): [Key, Key] => shape === 'primitive' ? ['prefix', key]
        : shape === 'primitive-object' ? [key, object] : [object, key];
      const select = store.createSelector((state, first: Key, second: Key) => ({
        count: state.counter.count, first, second,
      }));
      const first = select(...args('shared'));
      const sibling = select(...args('sibling'));
      type Value = { count: number; first: Key; second: Key };
      const valuesA: Value[] = [], valuesB: Value[] = [], siblingValues: Value[] = [];
      const stopA = watch(first, valuesA), stopB = watch(first, valuesB);
      watch(sibling, siblingValues);
      expect(valuesA[0]).toBe(valuesB[0]);
      expect(select(...args('shared'))).toBe(first);
      stopA();
      for (let i = 0; i < 128; i += 1) {
        watch(select(...args(`unrelated-${i}`)))();
        expect(select(...args('shared'))).toBe(first);
        expect(select(...args('sibling'))).toBe(sibling);
      }
      setCount(2);
      setCount(3);
      expect(valuesB.map((value) => value.count)).toEqual([1]);
      expect(vi.getTimerCount()).toBe(1);
      flush();
      expect(valuesA.map((value) => value.count)).toEqual([1]);
      expect(valuesB.map((value) => value.count)).toEqual([1, 3]);
      expect(siblingValues.map((value) => value.count)).toEqual([1, 3]);
      stopB();
      setCount(5);
      flush();
      const fresh = select(...args('shared'));
      expect(fresh).not.toBe(first);
      const freshValues: Value[] = [], oldValues: Value[] = [];
      const stopFresh = watch(fresh, freshValues), stopOld = watch(first, oldValues);
      expect(freshValues.map((value) => value.count)).toEqual([5]);
      expect(oldValues.map((value) => value.count)).toEqual([5]);
      expect(select(...args('shared'))).toBe(fresh);
      setCount(6);
      flush();
      expect(freshValues.map((value) => value.count)).toEqual([5, 6]);
      expect(oldValues.map((value) => value.count)).toEqual([5, 6]);
      stopOld();
      expect(select(...args('shared'))).toBe(fresh);
      setCount(7);
      flush();
      expect(freshValues.map((value) => value.count)).toEqual([5, 6, 7]);
      expect(oldValues.map((value) => value.count)).toEqual([5, 6]);
      expect(select(...args('sibling'))).toBe(sibling);
      stopFresh();
      expect(select(...args('shared'))).not.toBe(fresh);
    }
  );

  it('keeps mixed key identity and ordering separate while other branches release', () => {
    const select = store.createSelector((_state, first: Key, second: Key) => [first, second]);
    const object = { id: 'same' }, copy = { id: 'same' };
    const entries: [Key, Key][] = [['prefix', object], ['prefix', copy], [object, 'prefix']];
    const outputs = entries.map((args) => select(...args));
    const stops = outputs.map((output) => watch(output));
    expect(new Set(outputs).size).toBe(3);
    stops[0]();
    for (let i = 0; i < 64; i += 1) watch(select(`other-${i}`, object))();
    expect(select(...entries[0])).not.toBe(outputs[0]);
    expect(select(...entries[1])).toBe(outputs[1]);
    expect(select(...entries[2])).toBe(outputs[2]);
  });

  it('retains shallow-equal result references while active and reads latest state after release', () => {
    const callback = vi.fn((state: { counter: { count: number } }, _key: string) => ({ parity: state.counter.count % 2 }));
    const select = store.createSelector(callback);
    const output = select('shared');
    const values: Array<{ parity: number }> = [], concurrent: Array<{ parity: number }> = [];
    const stop = watch(output, values);
    const initial = values[0], calls = callback.mock.calls.length;
    setCount(3);
    flush();
    expect(callback.mock.calls.length).toBeGreaterThan(calls);
    expect(values).toHaveLength(1);
    const stopConcurrent = watch(output, concurrent);
    expect(concurrent[0]).toBe(initial);
    stop();
    stopConcurrent();
    setCount(4);
    flush();
    const fresh = select('shared');
    expect(fresh).not.toBe(output);
    const freshValues: Array<{ parity: number }> = [], oldValues: Array<{ parity: number }> = [];
    watch(fresh, freshValues);
    watch(output, oldValues);
    expect(freshValues).toEqual([{ parity: 0 }]);
    expect(oldValues).toEqual([{ parity: 0 }]);
    expect(oldValues[0]).not.toBe(initial);
  });

  it('preserves observable arguments, locks and cadence across churn and output recreation', () => {
    const reactive = reactiveFixture(store);
    const output = reactive.get();
    const values: number[] = [], concurrent: number[] = [];
    const stop = watch(output, values), stopConcurrent = watch(output, concurrent);
    stop();
    for (let i = 0; i < 64; i += 1) watch(reactive.churn(`other-${i}`))();
    expect(reactive.get()).toBe(output);
    reactive.set(3);
    expect(values).toEqual([2]);
    expect(concurrent).toEqual([2, 3]);
    store.dispatch(lockUpdates());
    flush();
    setCount(5);
    flush();
    reactive.set(4);
    expect(concurrent).toEqual([2, 3]);
    store.dispatch(unlockUpdates());
    flush();
    expect(concurrent).toEqual([2, 3, 20]);
    setCount(6);
    setCount(7);
    expect(concurrent).toEqual([2, 3, 20]);
    expect(vi.getTimerCount()).toBe(1);
    flush();
    expect(concurrent).toEqual([2, 3, 20, 28]);
    stopConcurrent();
    reactive.set(5);
    setCount(8);
    flush();
    const fresh = reactive.get();
    expect(fresh).not.toBe(output);
    const freshValues: number[] = [], oldValues: number[] = [];
    watch(fresh, freshValues);
    const stopOld = watch(output, oldValues);
    expect(freshValues).toEqual([40]);
    expect(oldValues).toEqual([40]);
    stopOld();
    expect(reactive.get()).toBe(fresh);
    reactive.set(6);
    expect(freshValues).toEqual([40, 48]);
    expect(oldValues).toEqual([40]);
  });

  it('cancels pending cadence work with active observers and protects reinitialized outputs from old cleanup', () => {
    const select = store.createSelector((state, _key: string) => state.counter.count);
    const old = select('shared');
    const oldValues: number[] = [], secondValues: number[] = [];
    const stopOld = watch(old, oldValues), stopSecond = watch(old, secondValues);
    setCount(2);
    expect(vi.getTimerCount()).toBe(1);
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
    flush();
    expect(oldValues).toEqual([1]);
    expect(secondValues).toEqual([1]);
    expect(() => select('shared')).toThrow('before Store.init()');
    store.init({ counter: { count: 10 } });
    const fresh = select('shared');
    const freshValues: number[] = [];
    watch(fresh, freshValues);
    expect(fresh).not.toBe(old);
    expect(freshValues).toEqual([10]);
    stopOld();
    stopSecond();
    expect(select('shared')).toBe(fresh);
    setCount(11);
    flush();
    expect(freshValues).toEqual([10, 11]);
    expect(oldValues).toEqual([1]);
    expect(secondValues).toEqual([1]);
  });

  it('keeps undefined selected data inside output objects and preserves cumulative cache traces until disposal', () => {
    store.dispose();
    store = create({ traceSelectors: { traceCache: true }, loggerFactory: () => undefined });
    store.init();
    const events: unknown[] = [];
    const trace = store.traceStreams.selectorDetail.observe((event) => {
      if (event.kind === 'cache') events.push([
        event.outputCacheStatus, event.outputCacheRequestCount, event.outputCacheHitCount,
        event.outputCacheMissCount, event.observableCacheCachedCount,
      ]);
    });
    cleanups.push(() => trace.unsubscribe());
    const select = store.createSelector((_state, _key: string) => undefined);
    const first = select('shared');
    expect(typeof first).toBe('object');
    const values: undefined[] = [];
    const stopA = watch(first, values), stopB = watch(first);
    expect(values).toEqual([undefined]);
    stopA();
    expect(select('shared')).toBe(first);
    stopB();
    const fresh = select('shared');
    expect(typeof fresh).toBe('object');
    expect(fresh).not.toBe(first);
    watch(fresh);
    watch(first)();
    expect(select('shared')).toBe(fresh);
    expect(events).toEqual([
      ['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1],
      ['miss', 3, 1, 2, 2], ['hit', 4, 2, 2, 2],
    ]);
    store.dispose();
    store.init();
    const reinitialized = select('shared');
    expect(reinitialized).not.toBe(fresh);
    expect(events.at(-1)).toEqual(['miss', 1, 0, 1, 1]);
  });
});