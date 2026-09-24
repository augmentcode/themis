import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as currentCache from './selector-output-cache';
import { StreamingStore as CurrentStreamingStore } from '../../streaming-store';
import type { SelectorOutputCacheOptions } from '../types';

// The same semantic assertions can run against the read-only built baseline.
const builtRoot = process.env.SELECTOR_CACHE_BUILT_ROOT;
const cache: typeof currentCache = builtRoot
  ? await import(pathToFileURL(resolve(builtRoot, 'dist/utils/selector-core/selector-output-cache.js')).href)
  : currentCache;
const StreamingStore: typeof CurrentStreamingStore = builtRoot
  ? (await import(pathToFileURL(resolve(builtRoot, 'dist/streaming-store.js')).href)).StreamingStore
  : CurrentStreamingStore;

type Trace = {
  outputCacheStatus?: string;
  outputCacheRequestCount?: number;
  outputCacheHitCount?: number;
  outputCacheMissCount?: number;
  observableCacheRequestCount?: number;
  observableCacheCachedCount?: number;
};
const counts = (event: object) => {
  const trace = event as Trace;
  return [trace.outputCacheStatus, trace.outputCacheRequestCount,
    trace.outputCacheHitCount, trace.outputCacheMissCount, trace.observableCacheCachedCount];
};
const core = () => {
  const source = {}, selector = () => 0, args = ['shared', 1], events: unknown[][] = [];
  let hook: (() => void) | undefined;
  const options: SelectorOutputCacheOptions = { traceReporter: (trace) => {
    if (!('observableCacheRequestCount' in trace)) throw Error('Expected a cache trace');
    expect(trace.observableCacheRequestCount).toBe(trace.outputCacheRequestCount);
    events.push(counts(trace)); hook?.();
  } };
  return {
    source, selector, args, events,
    get: (factory: (release: () => void) => unknown) => cache.getOrCreate(source, selector, args, factory, options),
    once: (action: () => void) => { hook = () => { hook = undefined; action(); }; },
    evict: (value?: unknown) => cache.evictSelectorOutput(source, selector, args, value),
    dispose: () => cache.evictSelectorOutputsForStateSource(source),
  };
};

describe('core cache synchronous trace return contract', () => {
  it.each([false, true])('reads the hit leaf after release, replacement=%s', (replace) => {
    const c = core(), first = {}, replacement = {};
    c.get(() => first);
    c.once(() => { c.evict(first); if (replace) c.get(() => replacement); });
    expect(c.get(() => ({}))).toBe(replace ? replacement : undefined);
    expect(c.events).toEqual([
      ['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1], ...(replace ? [['miss', 3, 1, 2, 2]] : []),
    ]);
    c.dispose();
  });

  it('lets nested hits both return the replacement with exact synchronous trace order', () => {
    const c = core(), first = {}, replacement = {};
    c.get(() => first);
    c.once(() => {
      c.once(() => { c.evict(first); c.get(() => replacement); });
      expect(c.get(() => ({}))).toBe(replacement);
    });
    expect(c.get(() => ({}))).toBe(replacement);
    expect(c.events).toEqual([
      ['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1], ['hit', 3, 2, 1, 1], ['miss', 4, 2, 2, 2],
    ]);
    c.dispose();
  });

  it.each(['none', 'release', 'replace'] as const)('preserves thrown hit reporter errors and %s side effects', (effect) => {
    const c = core(), first = {}, replacement = {}, error = Error('trace');
    c.get(() => first);
    c.once(() => {
      if (effect !== 'none') c.evict(first);
      if (effect === 'replace') c.get(() => replacement);
      throw error;
    });
    expect(() => c.get(() => ({}))).toThrow(error);
    expect(c.events).toEqual([
      ['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1], ...(effect === 'replace' ? [['miss', 3, 1, 2, 2]] : []),
    ]);
    const next = {};
    expect(c.get(() => next)).toBe(effect === 'none' ? first : effect === 'replace' ? replacement : next);
    c.dispose();
  });

  it.each([false, true])('returns a miss local result despite reporter replacement, throwing=%s', (throws) => {
    const c = core(), first = {}, replacement = {}, error = Error('miss trace');
    c.once(() => {
      c.evict(first); c.get(() => replacement);
      if (throws) throw error;
    });
    if (throws) expect(() => c.get(() => first)).toThrow(error);
    else expect(c.get(() => first)).toBe(first);
    expect(c.events).toEqual([['miss', 1, 0, 1, 1], ['miss', 2, 0, 2, 2]]);
    expect(c.get(() => ({}))).toBe(replacement);
    c.dispose();
  });

  it('does not roll back a completed factory when miss reporting throws', () => {
    const c = core(), first = {}, error = Error('trace');
    c.once(() => { throw error; });
    expect(() => c.get(() => first)).toThrow(error);
    expect(c.get(() => ({}))).toBe(first);
    expect(c.events).toEqual([['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1]]);
    c.dispose();
  });

  it.each(['hit', 'miss'] as const)('preserves disposed %s return expressions in either release ordering', (status) => {
    for (const releaseFirst of [false, true]) {
      const c = core(), first = {}, replacement = {};
      if (status === 'hit') c.get(() => first);
      c.once(() => {
        if (releaseFirst) c.evict(first);
        c.dispose();
        if (!releaseFirst) c.evict(first); // disposal made the old leaf unreachable
        c.get(() => replacement);
      });
      expect(c.get(() => first)).toBe(status === 'hit' && releaseFirst ? undefined : first);
      expect(c.events).toEqual(status === 'hit'
        ? [['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1], ['miss', 1, 0, 1, 1]]
        : [['miss', 1, 0, 1, 1], ['miss', 1, 0, 1, 1]]);
      expect(c.get(() => ({}))).toBe(replacement);
      c.dispose();
    }
  });

  it('counts both completed nested factories without changing the outer overwrite winner', () => {
    const c = core(), inner = {}, outer = {};
    expect(c.get(() => { c.get(() => inner); return outer; })).toBe(outer);
    expect(c.get(() => ({}))).toBe(outer);
    expect(c.events).toEqual([['miss', 2, 0, 1, 1], ['miss', 2, 0, 2, 2], ['hit', 3, 1, 2, 2]]);
    c.dispose();
  });
});

const publicFixture = () => {
  const reducer = Object.assign((state = { value: 1 }) => state, { initialState: { value: 1 } });
  const store = new StreamingStore({ counter: reducer }, undefined, {
    traceSelectors: { traceCache: true }, loggerFactory: () => undefined,
  });
  store.init();
  // Selected data is undefined, but the cached public output must still be an object.
  const select = store.createSelector((_state, _key: string) => undefined);
  const events: unknown[][] = [];
  let hook: (() => void) | undefined;
  const listener = store.traceStreams.selectorDetail.observe((event) => {
    if (event.kind !== 'cache') return;
    events.push(counts(event)); hook?.();
  });
  return {
    store, events, get: () => select('key'),
    once: (action: () => void) => { hook = () => { hook = undefined; action(); }; },
    finish: () => { listener.unsubscribe(); store.dispose(); },
  };
};

describe('public StreamingStore trace listener reentry', () => {
  it.each([false, true])('returns the post-report hit value after final unsubscribe, replacement=%s', (replace) => {
    const c = publicFixture();
    try {
      const first = c.get(), values: unknown[] = [];
      expect(typeof first).toBe('object');
      const subscription = first.observe((value) => values.push(value));
      expect(values).toEqual([undefined]);
      let replacement: typeof first | undefined;
      c.once(() => { subscription.unsubscribe(); if (replace) replacement = c.get(); });
      expect(c.get()).toBe(replacement);
      expect(c.events).toEqual([
        ['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1], ...(replace ? [['miss', 3, 1, 2, 2]] : []),
      ]);
      if (replace) {
        expect(replacement).not.toBe(first);
        // Old output reactivation invokes its stale release again, not an undefined wildcard.
        first.observe(() => {}).unsubscribe();
        expect(c.get()).toBe(replacement);
      }
    } finally { c.finish(); }
  });

  it('preserves nested public hit returns and trace order', () => {
    const c = publicFixture();
    try {
      const first = c.get(), subscription = first.observe(() => {});
      let replacement: typeof first | undefined;
      c.once(() => {
        c.once(() => { subscription.unsubscribe(); replacement = c.get(); });
        expect(c.get()).toBe(replacement);
      });
      expect(c.get()).toBe(replacement);
      expect(c.events).toEqual([
        ['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1], ['hit', 3, 2, 1, 1], ['miss', 4, 2, 2, 2],
      ]);
    } finally { c.finish(); }
  });

  it.each(['none', 'release', 'replace'] as const)('propagates public trace errors after %s side effects', (effect) => {
    const c = publicFixture(), error = Error('listener');
    try {
      const first = c.get(), subscription = first.observe(() => {});
      let replacement: typeof first | undefined;
      c.once(() => {
        if (effect !== 'none') subscription.unsubscribe();
        if (effect === 'replace') replacement = c.get();
        throw error;
      });
      expect(() => c.get()).toThrow(error);
      expect(c.events).toEqual([
        ['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1], ...(effect === 'replace' ? [['miss', 3, 1, 2, 2]] : []),
      ]);
      const next = c.get();
      if (effect === 'none') expect(next).toBe(first);
      else if (effect === 'replace') expect(next).toBe(replacement);
      else expect(next).not.toBe(first);
      subscription.unsubscribe();
    } finally { c.finish(); }
  });

  it.each([false, true])('preserves the public miss local output after replacement, throwing=%s', (throws) => {
    const c = publicFixture(), error = Error('miss listener');
    try {
      let first: ReturnType<typeof c.get> | undefined, replacement: typeof first;
      c.once(() => {
        first = c.get(); first.observe(() => {}).unsubscribe(); replacement = c.get();
        if (throws) throw error;
      });
      if (throws) expect(() => c.get()).toThrow(error);
      else expect(c.get()).toBe(first);
      expect(c.events).toEqual([['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1], ['miss', 3, 1, 2, 2]]);
      expect(first).not.toBe(replacement);
      expect(c.get()).toBe(replacement);
    } finally { c.finish(); }
  });

  it('keeps the public installed miss output when its listener throws without releasing', () => {
    const c = publicFixture(), error = Error('miss listener');
    try {
      let first: ReturnType<typeof c.get> | undefined;
      c.once(() => { first = c.get(); throw error; });
      expect(() => c.get()).toThrow(error);
      expect(c.get()).toBe(first);
      expect(c.events).toEqual([['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1], ['hit', 3, 2, 1, 1]]);
    } finally { c.finish(); }
  });

  it.each([false, true])('preserves public disposed hit identity with release-first=%s', (releaseFirst) => {
    const c = publicFixture();
    try {
      const first = c.get(), subscription = first.observe(() => {});
      let replacement: typeof first | undefined;
      c.once(() => {
        if (releaseFirst) subscription.unsubscribe();
        c.store.dispose();
        if (!releaseFirst) subscription.unsubscribe();
        c.store.init(); replacement = c.get();
      });
      expect(c.get()).toBe(releaseFirst ? undefined : first);
      expect(c.events).toEqual([['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1], ['miss', 1, 0, 1, 1]]);
      expect(c.get()).toBe(replacement);
    } finally { c.finish(); }
  });

  it.each([false, true])('preserves public disposed miss local identity with release-first=%s', (releaseFirst) => {
    const c = publicFixture();
    try {
      let first: ReturnType<typeof c.get> | undefined, replacement: typeof first;
      c.once(() => {
        first = c.get();
        const subscription = first.observe(() => {});
        if (releaseFirst) subscription.unsubscribe();
        c.store.dispose();
        if (!releaseFirst) subscription.unsubscribe();
        c.store.init(); replacement = c.get();
      });
      expect(c.get()).toBe(first);
      expect(c.events).toEqual([['miss', 1, 0, 1, 1], ['hit', 2, 1, 1, 1], ['miss', 1, 0, 1, 1]]);
      expect(c.get()).toBe(replacement);
    } finally { c.finish(); }
  });
});