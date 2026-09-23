import { describe, expect, it } from 'vitest';
import { evictSelectorOutput, evictSelectorOutputsForStateSource, getOrCreate } from '../../src/utils/selector-core/selector-output-cache';

describe('unchanged cache semantics required by pruning', () => {
  it('keeps live siblings, prefix values and never-activated outputs', () => {
    const source = {}, selector = () => 0, object = {};
    const prefix = getOrCreate(source, selector, [1], () => ({}));
    const sibling = getOrCreate(source, selector, [1, object], () => ({}));
    const descendant = getOrCreate(source, selector, [1, object, 2], () => ({}));
    evictSelectorOutput(source, selector, [1, object, 2], descendant);
    expect(getOrCreate(source, selector, [1], () => ({}))).toBe(prefix);
    expect(getOrCreate(source, selector, [1, object], () => ({}))).toBe(sibling);
    evictSelectorOutput(source, selector, [1], prefix);
    expect(getOrCreate(source, selector, [1, object], () => ({}))).toBe(sibling);
    evictSelectorOutputsForStateSource(source);
  });

  it('keeps stale release harmless after recreation', () => {
    const source = {}, selector = () => 0;
    let oldRelease = () => {};
    getOrCreate(source, selector, [1], (release) => { oldRelease = release; return {}; });
    oldRelease();
    const replacement = getOrCreate(source, selector, [1], () => ({}));
    oldRelease();
    expect(getOrCreate(source, selector, [1], () => ({}))).toBe(replacement);
    evictSelectorOutputsForStateSource(source);
  });

  it('retries after a throwing factory without disturbing an installed sibling', () => {
    const source = {}, selector = () => 0;
    const sibling = getOrCreate(source, selector, [1, 2], () => ({}));
    expect(() => getOrCreate(source, selector, [1, 3], () => { throw Error('factory'); })).toThrow('factory');
    expect(getOrCreate(source, selector, [1, 2], () => ({}))).toBe(sibling);
    const retry = getOrCreate(source, selector, [1, 3], () => ({}));
    expect(getOrCreate(source, selector, [1, 3], () => ({}))).toBe(retry);
    evictSelectorOutputsForStateSource(source);
  });

  it('lets the outer factory overwrite a same-key reentrant installation', () => {
    const source = {}, selector = () => 0, inner = {}, outer = {};
    let innerRelease = () => {};
    expect(getOrCreate(source, selector, [1], () => {
      expect(getOrCreate(source, selector, [1], (release) => { innerRelease = release; return inner; })).toBe(inner);
      return outer;
    })).toBe(outer);
    innerRelease();
    expect(getOrCreate(source, selector, [1], () => ({}))).toBe(outer);
    evictSelectorOutputsForStateSource(source);
  });

  it('keeps an in-flight path attached when its factory releases a sibling', () => {
    const source = {}, selector = () => 0;
    let releaseSibling = () => {};
    getOrCreate(source, selector, [1, 2], (release) => { releaseSibling = release; return {}; });
    const output = getOrCreate(source, selector, [1, 3], () => { releaseSibling(); return {}; });
    expect(getOrCreate(source, selector, [1, 3], () => ({}))).toBe(output);
    evictSelectorOutputsForStateSource(source);
  });

  it('does not resurrect a source branch disposed during its factory', () => {
    const source = {}, selector = () => 0;
    const detached = getOrCreate(source, selector, [1], () => { evictSelectorOutputsForStateSource(source); return {}; });
    expect(getOrCreate(source, selector, [1], () => ({}))).not.toBe(detached);
    evictSelectorOutputsForStateSource(source);
  });

  it('does not turn release-before-return into deferred eviction', () => {
    const source = {}, selector = () => 0;
    const output = getOrCreate(source, selector, [1], (release) => { release(); return {}; });
    expect(getOrCreate(source, selector, [1], () => ({}))).toBe(output);
    evictSelectorOutputsForStateSource(source);
  });

  it('preserves the existing undefined-output wildcard behavior rather than broadening this fix', () => {
    const source = {}, selector = () => 0;
    let oldRelease = () => {};
    getOrCreate(source, selector, [1], (release) => { oldRelease = release; return undefined; });
    oldRelease();
    const replacement = getOrCreate(source, selector, [1], () => ({}));
    oldRelease();
    expect(getOrCreate(source, selector, [1], () => ({}))).not.toBe(replacement);
    evictSelectorOutputsForStateSource(source);
  });
});