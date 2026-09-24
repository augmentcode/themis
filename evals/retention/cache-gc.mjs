import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';

assert.equal(typeof global.gc, 'function', 'run this fixture with node --expose-gc');
const root = resolve(process.argv[2] ?? '.');
const { getOrCreate, evictSelectorOutputsForStateSource } = await import(
  pathToFileURL(resolve(root, 'dist/utils/selector-core/selector-output-cache.js')).href
);
const results = [];

async function collected(name, refs) {
  for (let attempt = 0; attempt < 30; attempt++) {
    // A deref keeps its target alive for the current job. Cross a job before collecting.
    await nextTurn();
    global.gc();
    await nextTurn();
    if (refs.every((ref) => ref.deref() === undefined)) {
      results.push({ name, collected: refs.length, attempts: attempt + 1 });
      return;
    }
  }
  assert.fail(`${name}: ${refs.filter((ref) => ref.deref() !== undefined).length} references retained`);
}

function keyBranch(source, selector, shape, release) {
  const object = {}, fn = () => 1, payload = { slots: new Array(8).fill(7) };
  const paths = [
    [object, 'primitive', fn], ['primitive', object, fn], [fn, 'primitive', object],
    ['primitive', fn, object], ['shared', object, 'primitive', fn], ['shared', fn, 'primitive', object],
  ];
  const args = paths[shape];
  const output = getOrCreate(source, selector, args, (cleanup) => ({ object, fn, payload, cleanup }));
  if (release) output.cleanup();
  return [object, fn, payload, args, output, output.cleanup].map((value) => new WeakRef(value));
}

function keyFixture(release) {
  const source = {}, selector = () => 0;
  const prefix = getOrCreate(source, selector, ['shared'], () => ({}));
  const sibling = getOrCreate(source, selector, ['live'], () => ({}));
  const refs = Array.from({ length: 6 }, (_, shape) => keyBranch(source, selector, shape, release)).flat();
  return { source, selector, prefix, sibling, refs };
}

// A kept selector must not share the factory's payload lexical environment.
const freshSelector = () => () => 0;

function ownerFixture(owner, release) {
  const source = {}, selector = freshSelector(), payload = { slots: new Array(8).fill(9) };
  const output = getOrCreate(source, selector, ['primitive'], (cleanup) => ({ payload, cleanup }));
  if (release) output.cleanup();
  const weakOwners = owner === 'source' ? [source] : owner === 'selector' ? [selector] : [source, selector];
  return {
    keeper: owner === 'source' ? selector : owner === 'selector' ? source : null,
    refs: [...weakOwners, output, payload, output.cleanup].map((value) => new WeakRef(value)),
  };
}

function oldReleasedOutput(source, selector) {
  const output = getOrCreate(source, selector, ['shared', 'old'], (cleanup) => ({ cleanup }));
  output.cleanup();
  return output;
}

function primitiveSibling(source, selector) {
  const key = {}, payload = { slots: new Array(8).fill(11) };
  const output = getOrCreate(source, selector, ['shared', 'unrelated'], (cleanup) => ({ key, payload, cleanup }));
  return [key, payload, output, output.cleanup].map((value) => new WeakRef(value));
}

function retainedReleaseFixture() {
  const source = {}, selector = () => 0;
  // Install the sibling first so any accidentally captured ancestor path reaches it.
  const disposedRefs = primitiveSibling(source, selector);
  const retainedOutput = oldReleasedOutput(source, selector);
  const retainedRelease = retainedOutput.cleanup;
  const releasedRefs = keyBranch(source, selector, 4, true);
  const abandonedRefs = keyBranch(source, selector, 5, false);
  return { source, selector, retainedOutput, retainedRelease, disposedRefs, releasedRefs, abandonedRefs };
}

for (const release of [false, true]) {
  const fixture = keyFixture(release);
  await collected(`mixed object/function keys, explicit release=${release}`, fixture.refs);
  assert.equal(getOrCreate(fixture.source, fixture.selector, ['shared'], () => ({})), fixture.prefix);
  assert.equal(getOrCreate(fixture.source, fixture.selector, ['live'], () => ({})), fixture.sibling);
  evictSelectorOutputsForStateSource(fixture.source);
  for (const owner of ['source', 'selector', 'both']) {
    const owners = ownerFixture(owner, release);
    await collected(`${owner} owners, explicit release=${release}`, owners.refs);
    assert.equal(owners.keeper === null, owner === 'both');
  }
}

const retained = retainedReleaseFixture();
await collected('released siblings with old callback/output retained', retained.releasedRefs);
await collected('unreleased weak siblings with old callback/output retained', retained.abandonedRefs);
assert(retained.disposedRefs.every((ref) => ref.deref() !== undefined), 'primitive sibling must stay cached before disposal');
evictSelectorOutputsForStateSource(retained.source);
await collected('unrelated primitive branch after disposal with old callback/output retained', retained.disposedRefs);
const replacement = getOrCreate(retained.source, retained.selector, ['shared', 'old'], () => ({}));
retained.retainedRelease();
assert.equal(getOrCreate(retained.source, retained.selector, ['shared', 'old'], () => ({})), replacement);
assert.equal(retained.retainedOutput.cleanup, retained.retainedRelease);
evictSelectorOutputsForStateSource(retained.source);

console.log(JSON.stringify({ root, node: process.version, timestamp: new Date().toISOString(), skipped: 0, results }, null, 2));