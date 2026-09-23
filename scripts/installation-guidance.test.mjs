import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { runCli } from './cli.mjs';
import { installIntentSkillGuidance, parseInstalledSkillsManifest } from './postinstall.mjs';

const tempRoots = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('executes the documented narrowing refresh only in an isolated fixture', async () => {
  const documentation = await readFile(new URL('../docs/INSTALLATION.md', import.meta.url), 'utf8');
  const code = documentation.split('### Narrowing an existing bundle')[1]?.match(/```bash\n([\s\S]*?)```/)?.[1];
  expect(code, 'Documented refresh example must exist').toBeDefined();
  const commands = code.split('\n').filter((line) => line.startsWith('npx themis ')).map((line) => line.slice('npx themis '.length));
  expect(commands).toHaveLength(2);
  const root = await mkdtemp(join(tmpdir(), 'themis-guidance-refresh-'));
  tempRoots.push(root);
  const packageRoot = join(root, 'package');
  const projectRoot = join(root, 'consumer');
  const destination = join(projectRoot, '.agents/skills/themis');
  const write = async (path, content) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); };
  const paths = ['SKILL.md', 'setup/SKILL.md', 'core/SKILL.md', 'react/SKILL.md', 'svelte/SKILL.md', 'streaming/SKILL.md'];
  await Promise.all([
    write(join(packageRoot, 'package.json'), JSON.stringify({ name: '@augmentcode/themis', version: '0.0.0' })),
    ...paths.map((path) => write(join(packageRoot, 'skills', path), path)),
    write(join(destination, 'core/SKILL.md'), 'user-created without a manifest'),
  ]);
  const logger = { log: vi.fn(), warn: vi.fn() };
  const results = [];
  const invoke = (command) => runCli([command], { cwd: () => projectRoot, logger, install: (options) => {
    results.push(installIntentSkillGuidance({ ...options, packageRoot }));
  } });
  expect(await invoke(commands[0])).toBe(0);
  expect(results[0]).toMatchObject({ copied: 5, updated: 1 });
  expect(await readFile(join(destination, 'core/SKILL.md'), 'utf8')).toBe('core/SKILL.md');
  const unowned = join(destination, 'react/my-notes.md');
  const unrelated = join(projectRoot, '.agents/skills/custom/SKILL.md');
  await Promise.all([write(unowned, 'user notes'), write(unrelated, 'third-party'), write(join(destination, 'react/SKILL.md'), 'edited but still manifest-owned')]);
  const unchanged = await stat(join(destination, 'core/SKILL.md'));
  const priorManifest = await readFile(join(destination, 'installed-skills.yml'), 'utf8');
  expect(await invoke(commands[1])).toBe(0);
  expect(results[1]).toMatchObject({ copied: 0, updated: 0, unchanged: 3, removed: 3, skillInstallTarget: 'core' });
  for (const family of ['react', 'svelte', 'streaming']) expect(existsSync(join(destination, family, 'SKILL.md'))).toBe(false);
  expect(await readFile(unowned, 'utf8')).toBe('user notes');
  expect(await readFile(unrelated, 'utf8')).toBe('third-party');
  expect((await stat(join(destination, 'core/SKILL.md'))).mtimeMs).toBe(unchanged.mtimeMs);
  const nextManifest = await readFile(join(destination, 'installed-skills.yml'), 'utf8');
  expect(parseInstalledSkillsManifest(priorManifest).target).toBe('all');
  expect(parseInstalledSkillsManifest(nextManifest)).toMatchObject({ target: 'core', files: ['SKILL.md', 'core/SKILL.md', 'setup/SKILL.md'] });
  expect(await invoke(commands[1])).toBe(0);
  expect(results[2]).toMatchObject({ skipped: true, copied: 0, updated: 0, unchanged: 3, removed: 0 });
  // Selected destinations are refreshed even if a file there was user-edited.
  await write(join(destination, 'core/SKILL.md'), 'local edit');
  expect(await invoke(commands[1])).toBe(0);
  expect(results[3]).toMatchObject({ updated: 1, unchanged: 2 });
  expect(await readFile(join(destination, 'core/SKILL.md'), 'utf8')).toBe('core/SKILL.md');
  expect(logger.warn).not.toHaveBeenCalled();
});