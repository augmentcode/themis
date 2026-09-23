import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type * as Cache from './selector-output-cache';

type Node = {
  weakChildren?: WeakMap<object, Node>;
  primitiveChildren?: Map<unknown, Node>;
  cachedEntryCount?: number;
  operationCount?: number;
};

// Instrument only this isolated cache realm, never global Map or a GC worker.
const loadCache = () => {
  const maps: Map<unknown, Node>[] = [];
  const weakMaps: WeakMap<object, Node>[] = [];
  const nodes = new Set<Node>();
  class RecordingMap extends Map<unknown, Node> {
    constructor() { super(); maps.push(this); }
    set(key: unknown, node: Node) { nodes.add(node); return super.set(key, node); }
  }
  class RecordingWeakMap extends WeakMap<object, Node> {
    constructor() { super(); weakMaps.push(this); }
    set(key: object, node: Node) { nodes.add(node); return super.set(key, node); }
  }
  const path = process.env.SELECTOR_CACHE_SOURCE ?? 'src/utils/selector-core/selector-output-cache.ts';
  const code = ts.transpileModule(readFileSync(resolve(path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {} as typeof Cache;
  runInNewContext(code, { exports, Map: RecordingMap, WeakMap: RecordingWeakMap });
  return {
    ...exports,
    edges: () => maps.reduce((sum, map) => sum + map.size, 0),
    root: (source: object, selector: object) => {
      const owner = weakMaps.map((map) => map.get(source)).find((node) => node?.weakChildren);
      return owner!.weakChildren!.get(selector)!;
    },
    settled: () => {
      for (const node of nodes) {
        expect(node.operationCount ?? 0).toBe(0);
        expect(node.cachedEntryCount ?? 0).toBeGreaterThanOrEqual(0);
      }
    },
  };
};

describe('selector output cache path pruning', () => {
  it('bounds many unique releases with live zero-argument, prefix and sibling outputs', () => {
    const cache = loadCache(), source = {}, selector = () => 0;
    const paths = [[], ['prefix'], ['prefix', 'live'], ['other']];
    const outputs = paths.map((path) => cache.getOrCreate(source, selector, path, () => ({})));
    for (let i = 0; i < 512; i++) {
      let release = () => {};
      cache.getOrCreate(source, selector, ['prefix', i, 'leaf'], (cleanup) => {
        release = cleanup; return {};
      });
      release(); release();
      paths.forEach((path, j) => expect(cache.getOrCreate(source, selector, path, () => ({}))).toBe(outputs[j]));
      cache.settled();
    }
    expect(cache.edges()).toBe(3);
    expect(cache.root(source, selector).cachedEntryCount).toBe(4);
    paths.forEach((path, i) => cache.evictSelectorOutput(source, selector, path, outputs[i]));
    expect(cache.edges()).toBe(0);
    expect(cache.root(source, selector).cachedEntryCount).toBe(0);
    cache.settled();
  });

  it('preserves primitive equality and mixed object/function identity and ordering', () => {
    const cache = loadCache(), source = {}, selector = () => 0, object = {}, fn = () => 1;
    const symbol = Symbol('key');
    const keys = ['', '0', 0, NaN, Infinity, -Infinity, true, false, null, undefined, 0n, 1n, symbol, Symbol('key')];
    const paths = keys.flatMap((key) => [[key], [object, key, fn], [key, fn, object], [fn, object, key]]);
    const outputs = paths.map((path) => cache.getOrCreate(source, selector, path, () => ({})));
    expect(new Set(outputs).size).toBe(paths.length);
    paths.forEach((path, i) => expect(cache.getOrCreate(source, selector, path, () => ({}))).toBe(outputs[i]));
    expect(cache.getOrCreate(source, selector, [-0], () => ({}))).toBe(outputs[8]);
    expect(cache.getOrCreate(source, selector, [Number('NaN')], () => ({}))).toBe(outputs[12]);
    expect(cache.getOrCreate(source, selector, [object, '0', () => 1], () => ({}))).not.toBe(outputs[5]);
    cache.evictSelectorOutput(source, selector, [object, '0', () => 1]); // different function is absent
    for (let i = paths.length - 1; i >= 0; i--) cache.evictSelectorOutput(source, selector, paths[i], outputs[i]);
    // The never-released distinct function branch above is deliberately still occupied.
    expect(cache.edges()).toBe(1);
    cache.settled();
  });

  it('removes released suffixes even beneath conservative weak-GC history', () => {
    const cache = loadCache(), source = {}, selector = () => 0, vanishedKey = {};
    cache.getOrCreate(source, selector, ['history', vanishedKey], () => ({}));
    const root = cache.root(source, selector);
    const history = root.primitiveChildren!.get('history')!;
    // Deterministically model silent WeakMap removal, without claiming to observe GC.
    history.weakChildren!.delete(vanishedKey);
    for (let i = 0; i < 256; i++) {
      const paths = [['history', i], ['fresh', i], [i, {}]];
      for (const path of paths) {
        const output = cache.getOrCreate(source, selector, path, () => ({}));
        cache.evictSelectorOutput(source, selector, path, output);
      }
    }
    expect(cache.edges()).toBe(1);
    expect(history.cachedEntryCount).toBe(1);
    expect(root.cachedEntryCount).toBe(1);
    cache.settled();
  });

  it('does not count hits or repeated/distinct stale cleanup as entry transitions', () => {
    const cache = loadCache(), source = {}, selector = () => 0;
    let oldRelease = () => {};
    cache.getOrCreate(source, selector, [1], (release) => { oldRelease = release; return {}; });
    oldRelease(); oldRelease();
    const replacement = cache.getOrCreate(source, selector, [1], () => ({}));
    for (let i = 0; i < 32; i++) {
      oldRelease();
      expect(cache.getOrCreate(source, selector, [1], () => ({}))).toBe(replacement);
    }
    expect(cache.root(source, selector).cachedEntryCount).toBe(1);
    cache.evictSelectorOutput(source, selector, [1], replacement);
    expect(cache.edges()).toBe(0);
    cache.settled();
  });

  it.each(['undefined', 'identical', 'early'] as const)('preserves the %s release guard behavior', (kind) => {
    const cache = loadCache(), source = {}, selector = () => 0, shared = {};
    let oldRelease = () => {};
    cache.getOrCreate(source, selector, [1], (release) => {
      oldRelease = release; return kind === 'undefined' ? undefined : shared;
    });
    oldRelease();
    const replacement = kind === 'identical' ? shared : {};
    if (kind === 'early') {
      cache.getOrCreate(source, selector, [1], (release) => {
        cache.getOrCreate(source, selector, [1], () => replacement);
        release();
        expect(cache.root(source, selector).cachedEntryCount).toBe(0);
        return shared;
      });
      expect(cache.getOrCreate(source, selector, [1], () => ({}))).toBe(shared);
      oldRelease();
    } else {
      cache.getOrCreate(source, selector, [1], () => replacement);
      oldRelease();
    }
    expect(cache.edges()).toBe(0);
    cache.settled();
  });

  it.each(['empty', 'installed', 'released'] as const)('unwinds factory errors after %s nested work', (nested) => {
    const cache = loadCache(), source = {}, selector = () => 0, inner = {}, error = Error('factory');
    expect(() => cache.getOrCreate(source, selector, ['a', 'b'], () => {
      if (nested !== 'empty') cache.getOrCreate(source, selector, ['a', 'b'], () => inner);
      if (nested === 'released') cache.evictSelectorOutput(source, selector, ['a', 'b'], inner);
      throw error;
    })).toThrow(error);
    cache.settled();
    if (nested === 'installed') {
      expect(cache.getOrCreate(source, selector, ['a', 'b'], () => ({}))).toBe(inner);
      expect(cache.root(source, selector).cachedEntryCount).toBe(1);
      cache.evictSelectorOutput(source, selector, ['a', 'b'], inner);
    }
    expect(cache.edges()).toBe(0);
  });

  it.each([false, true])('counts outer overwrite once after nested release=%s', (releaseInner) => {
    const cache = loadCache(), source = {}, selector = () => 0, inner = {}, outer = {};
    let release = () => {};
    const output = cache.getOrCreate(source, selector, [1], () => {
      cache.getOrCreate(source, selector, [1], (cleanup) => { release = cleanup; return inner; });
      if (releaseInner) release();
      return outer;
    });
    expect(output).toBe(outer);
    release();
    expect(cache.getOrCreate(source, selector, [1], () => ({}))).toBe(outer);
    expect(cache.root(source, selector).cachedEntryCount).toBe(1);
    cache.evictSelectorOutput(source, selector, [1], outer);
    expect(cache.edges()).toBe(0);
    cache.settled();
  });

  it('pins shared prefixes while factories release prefix/sibling values or catch nested errors', () => {
    const cache = loadCache(), source = {}, selector = () => 0;
    const prefix = cache.getOrCreate(source, selector, [1], () => ({}));
    const sibling = cache.getOrCreate(source, selector, [1, 2], () => ({}));
    const output = cache.getOrCreate(source, selector, [1, 3], () => {
      cache.evictSelectorOutput(source, selector, [1], prefix);
      cache.evictSelectorOutput(source, selector, [1, 2], sibling);
      expect(() => cache.getOrCreate(source, selector, [1, 3], () => { throw Error('inner'); })).toThrow('inner');
      expect(cache.root(source, selector).operationCount).toBe(1);
      return {};
    });
    expect(cache.getOrCreate(source, selector, [1, 3], () => ({}))).toBe(output);
    expect(cache.root(source, selector).cachedEntryCount).toBe(1);
    cache.evictSelectorOutput(source, selector, [1, 3], output);
    expect(cache.edges()).toBe(0);
    cache.settled();
  });

  it.each([false, true])('never resurrects disposed factory paths, including outer throw=%s', (throwOuter) => {
    const cache = loadCache(), source = {}, selector = () => 0, replacement = {}, detached = {};
    let stale = () => {};
    const call = () => cache.getOrCreate(source, selector, [1], (release) => {
      stale = release;
      cache.evictSelectorOutputsForStateSource(source);
      cache.getOrCreate(source, selector, [1], () => replacement);
      if (throwOuter) throw Error('outer');
      return detached;
    });
    if (throwOuter) expect(call).toThrow('outer'); else expect(call()).toBe(detached);
    // A throwing factory has the baseline undefined wildcard; do not invoke that release here.
    if (!throwOuter) stale();
    expect(cache.getOrCreate(source, selector, [1], () => ({}))).toBe(replacement);
    expect(cache.root(source, selector).cachedEntryCount).toBe(1);
    cache.evictSelectorOutput(source, selector, [1], replacement);
    expect(cache.root(source, selector).primitiveChildren?.size ?? 0).toBe(0);
    cache.settled();
  });

  it.each(['hit', 'miss'] as const)('holds %s pins through reporting and unwinds on reporter error', (status) => {
    for (const sideEffect of ['none', 'release', 'replace'] as const) {
      const cache = loadCache(), source = {}, selector = () => 0, first = {}, replacement = {};
      if (status === 'hit') cache.getOrCreate(source, selector, [1], () => first);
      const error = Error('reporter');
      expect(() => cache.getOrCreate(source, selector, [1], () => first, {
        traceReporter: () => {
          expect(cache.root(source, selector).operationCount).toBe(1);
          if (sideEffect !== 'none') cache.evictSelectorOutput(source, selector, [1], first);
          if (sideEffect === 'replace') cache.getOrCreate(source, selector, [1], () => replacement);
          throw error;
        },
      })).toThrow(error);
      cache.settled();
      if (sideEffect !== 'release') {
        expect(cache.getOrCreate(source, selector, [1], () => ({}))).toBe(sideEffect === 'none' ? first : replacement);
        cache.evictSelectorOutput(source, selector, [1]);
      }
      expect(cache.edges()).toBe(0);
    }
  });

  it('keeps nested hit pins independent until the outermost return', () => {
    const cache = loadCache(), source = {}, selector = () => 0, first = {}, replacement = {};
    cache.getOrCreate(source, selector, [1], () => first);
    expect(cache.getOrCreate(source, selector, [1], () => ({}), { traceReporter: () => {
      expect(cache.getOrCreate(source, selector, [1], () => ({}), { traceReporter: () => {
        cache.evictSelectorOutput(source, selector, [1], first);
        expect(cache.edges()).toBe(1);
        expect(cache.root(source, selector).operationCount).toBe(2);
        cache.getOrCreate(source, selector, [1], () => replacement);
      } })).toBe(replacement);
      expect(cache.root(source, selector).operationCount).toBe(1);
      cache.evictSelectorOutput(source, selector, [1], replacement);
      expect(cache.edges()).toBe(1);
    } })).toBeUndefined();
    expect(cache.edges()).toBe(0);
    cache.settled();
  });

  it.each(['hit', 'miss'] as const)('prunes normal %s report release only after evaluating its return', (status) => {
    const cache = loadCache(), source = {}, selector = () => 0, first = {};
    if (status === 'hit') cache.getOrCreate(source, selector, [1], () => first);
    const result = cache.getOrCreate(source, selector, [1], () => first, { traceReporter: () => {
      cache.evictSelectorOutput(source, selector, [1], first);
      expect(cache.edges()).toBe(1);
      expect(cache.root(source, selector).cachedEntryCount).toBe(0);
      expect(cache.root(source, selector).operationCount).toBe(1);
    } });
    expect(result).toBe(status === 'hit' ? undefined : first);
    expect(cache.edges()).toBe(0);
    cache.settled();
  });

  it.each(['hit', 'miss'] as const)('unpins disposed %s report paths without touching new source branches', (status) => {
    for (const releaseFirst of [false, true]) {
      const cache = loadCache(), source = {}, selector = () => 0, first = {}, replacement = {};
      if (status === 'hit') cache.getOrCreate(source, selector, [1], () => first);
      const result = cache.getOrCreate(source, selector, [1], () => first, { traceReporter: () => {
        if (releaseFirst) cache.evictSelectorOutput(source, selector, [1], first);
        cache.evictSelectorOutputsForStateSource(source);
        cache.getOrCreate(source, selector, [1], () => replacement);
      } });
      expect(result).toBe(status === 'hit' && releaseFirst ? undefined : first);
      expect(cache.getOrCreate(source, selector, [1], () => ({}))).toBe(replacement);
      expect(cache.root(source, selector).cachedEntryCount).toBe(1);
      cache.evictSelectorOutput(source, selector, [1], replacement);
      expect(cache.root(source, selector).primitiveChildren?.size ?? 0).toBe(0);
      cache.settled();
    }
  });
});