import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config, measure, shapes, verifyReferenceRelease } from './probe.mjs';

export function buildHash(root) {
  const hash = createHash('sha256');
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else hash.update(relative(root, path)).update('\0').update(readFileSync(path));
    }
  };
  visit(resolve(root, 'dist'));
  return hash.digest('hex');
}

export function checkSensitivity(normal, injected) {
  const liveDelta = injected.live.slopeBytesPerBatch - normal.live.slopeBytesPerBatch;
  const disposalDelta = injected.disposed.slopeBytesPerBatch - normal.disposed.slopeBytesPerBatch;
  assert(liveDelta > 96_000 && disposalDelta > 96_000, 'controlled retention was not detected');
  return { liveDelta, disposalDelta, minimumBytesPerBatch: 96_000 };
}

async function main() {
  const [mode, rootArgument, output, policy, inject] = process.argv.slice(2);
  const root = resolve(rootArgument ?? '.');
  if (mode === '--worker') {
    const { StreamingStore } = await import(pathToFileURL(resolve(root, 'dist/streaming-store.js')).href);
    const result = output === 'weak' ? await verifyReferenceRelease(StreamingStore)
      : await measure(StreamingStore, output, policy, inject === 'inject');
    console.log(JSON.stringify(result));
    return;
  }
  assert.equal(mode, '--run', 'usage: node --expose-gc evals/retention/run.mjs --run BUILT_ROOT OUTPUT_JSON');
  assert(output, 'output path required');
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const run = (shape, policy = 'unique', inject = false) => {
    const remaining = 180_000 - (performance.now() - start);
    assert(remaining > 0, '180s suite deadline exceeded');
    const child = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=256', fileURLToPath(import.meta.url),
      '--worker', root, shape, policy, inject ? 'inject' : 'normal'], {
      encoding: 'utf8', timeout: Math.min(20_000, remaining), killSignal: 'SIGKILL', maxBuffer: 1_000_000,
      env: { PATH: process.env.PATH, NODE_ENV: 'production' },
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, 'worker failed: ' + child.stderr);
    return JSON.parse(child.stdout.trim().split('\n').at(-1));
  };
  const results = [];
  for (const shape of shapes) for (const policy of ['unique', 'reused']) results.push(run(shape, policy));
  const injected = run('primitive-object', 'reused', true);
  const sensitivity = checkSensitivity(results.find((row) => row.shape === 'primitive-object' && row.policy === 'reused'), injected);
  const weak = run('weak');
  const report = { version: 1, startedAt, node: process.version, platform: process.platform, arch: process.arch,
    libraryRoot: root, buildSha256: buildHash(root), config, workerDeadlineMs: 20_000, suiteDeadlineMs: 180_000,
    elapsedMs: performance.now() - start, results, injected, sensitivity, weak };
  writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...report, results: results.map(({ live, disposed, ...rest }) => ({ ...rest,
    live: { ...live, samples: undefined }, disposed: { ...disposed, samples: undefined } })),
    injected: { live: injected.live.slopeBytesPerBatch, disposed: injected.disposed.slopeBytesPerBatch } }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();