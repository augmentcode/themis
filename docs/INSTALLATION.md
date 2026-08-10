# Installation, Cleanup, and Validation

This package has two separate workflows: consumer apps install the published package and explicitly copy a selected skill bundle; maintainers validate the package from a source checkout. Installing the package never copies skills automatically.

## 1. Consumer package installation

Install the package in the consuming app. Its `redux`, `redux-saga`, `typed-redux-saga`, and `fast-equals` runtime dependencies are installed with it:

```bash
npm install @augmentcode/themis
```

The package declares optional React/Preact peers for `ReactStore` and a Svelte peer for the Svelte-readable entrypoint; install the peer required by the chosen app. For saga tests that follow this repository's examples, install the optional test helper:

```bash
npm install -D redux-saga-test-plan
```

## 2. Explicit skill installation

Run one of these commands from the consuming project root after the package is installed. These are explicit copy/refresh operations, not package-install lifecycle side effects:

```bash
npx themis install-skills:react
npx themis install-skills:svelte
npx themis install-skills:streaming
npx themis install-skills:core
npx themis install-skills
npx themis install-skills:all
```

Every selected bundle:

- copies the selected packaged AI skill bundle into the consuming project root at `.agents/skills/themis/`, with skill folders directly underneath (root `SKILL.md`, `setup/`, `core/`, `react/`, `svelte/`, `streaming/`);
- keeps `.agents/skills/themis/` as the only copied and manifest-owned skill tree, then creates or reuses `.claude/skills/themis` as a directory symlink (relative on POSIX, junction on Windows) resolving to that canonical tree;
- never overwrites an existing file, directory, or foreign link at `.claude/skills/themis`; it preserves the collision and logs a warning while continuing the canonical install;
- if a previous install's `installed-skills.yml` manifest exists there, first removes every file that manifest lists and prunes empty directories, so each install fully refreshes the previous package install (user-authored files not listed in the manifest are preserved);
- writes a fresh `.agents/skills/themis/installed-skills.yml` manifest recording the package name, package version, install target, install timestamp, and the full list of installed relative file paths (the manifest itself is excluded from the list);
- removes package-owned skill copies left directly under the legacy flat `.agents/skills/` location as a one-time migration for existing consumers;
- preserves unrelated project or third-party skills under `.agents/skills/`;
- excludes generated package artifacts such as `skills/_artifacts`;
- no-ops when the package is not installed under a consumer `node_modules` directory;
- logs warnings instead of failing the command.

This keeps package installation side-effect free while still letting humans and AI agents discover and load the same package-specific implementation guidance when requested.

## 3. Consumer CLI and bundle selection

Consuming apps should run package maintenance commands from the app root after the package has been installed and its bin has been linked. These equivalent forms are supported:

```bash
./node_modules/.bin/themis help
npm exec -- themis help
npx themis
npx themis help
npx themis install-skills:react
npx themis install-skills:svelte
npx themis install-skills:streaming
npx themis install-skills
npx themis cleanup-skills
```

`npx themis` with no command prints the same help text. Use the smallest matching bundle:

| Command | Skills copied into `.agents/skills/themis/` |
| --- | --- |
| `npx themis install-skills:react` | root `SKILL.md`, `setup`, `core`, and `react` |
| `npx themis install-skills:svelte` | root `SKILL.md`, `setup`, `core`, and `svelte` |
| `npx themis install-skills:streaming` | root `SKILL.md`, `setup`, `core`, and `streaming` |
| `npx themis install-skills:core` | root `SKILL.md`, `setup`, and `core` |
| `npx themis install-skills` or `npx themis install-skills:all` | the complete all-skills bundle |

Each install command refreshes the selected package-owned bundle in `.agents/skills/themis/`, writes a fresh `installed-skills.yml` manifest, and reports copied, updated, unchanged, stale-removed, and Claude-link status. Repeating an unchanged command is a no-op for files and reuses a correct compatibility link. User-authored files not listed in the manifest, unrelated skills outside that directory, and non-selected package families are preserved. A collision at `.claude/skills/themis` is preserved with a warning; the canonical `.agents/skills/themis` install still proceeds.

If npm package invocation appears to do nothing, verify `./node_modules/.bin/themis` exists in the consuming app and run `./node_modules/.bin/themis help` directly. If that file is missing, the package is not installed or the package manager has not linked its bin in that app; reinstall or repair the local package install before retrying. In this repository's source checkout, `npx`/`npm exec` package-name invocations are not a valid smoke test because the package bin is not linked automatically; use `node scripts/cli.mjs help` for source-checkout validation.

## 4. Verify, refresh, cleanup, and uninstall

After installation, verify the CLI, copied bundle, manifest, and compatibility link. This Node command works on POSIX and Windows (the Windows compatibility path is a junction):

```bash
npx themis help
node -e "const fs=require('node:fs'); for (const p of ['.agents/skills/themis/SKILL.md','.agents/skills/themis/installed-skills.yml','.claude/skills/themis']) console.log(p, fs.realpathSync(p))"
```

Run the same selected install command whenever the package or desired bundle changes. The manifest-driven refresh removes stale package-owned files from the previous install while preserving files not listed in that manifest.

npm 7+ does not run dependency uninstall lifecycle scripts, so uninstalling the package does not automatically remove copied skill files. Run cleanup first, then uninstall:

```bash
npx themis cleanup-skills
# or: npm exec -- themis cleanup-skills
npm uninstall @augmentcode/themis
```

That helper removes only the files listed in `.agents/skills/themis/installed-skills.yml`, then the manifest itself, and removes only the owned `.claude/skills/themis` compatibility link (including a dangling owned link whose canonical target is already absent). It prunes only empty compatibility directories and prints a clear no-op message when no manifest or owned link exists. Foreign `.claude` paths and unrelated `.agents/skills` content remain untouched; as a one-time migration it also removes package-owned skill copies left directly under the legacy flat `.agents/skills/` location. Remove optional test dependencies only if your app does not use them elsewhere:

```bash
npm uninstall -D redux-saga-test-plan
```

If an older package has already been uninstalled, manually remove only package-owned skill files and folders you no longer need:

- `.agents/skills/themis/` (the current install location, including its `installed-skills.yml` manifest)
- `.agents/skills/SKILL.md` (legacy flat install location)
- `.agents/skills/setup` (legacy flat install location)
- `.agents/skills/svelte` (legacy flat install location)
- `.agents/skills/core` (legacy flat install location)
- `.agents/skills/react` (legacy flat install location)
- `.agents/skills/streaming` (legacy flat install location)
- `.agents/skills/svelte-redux-toolkit` (legacy `svelte-redux-toolkit` installs)
- `.agents/skills/init-svelte-redux-toolkit` (legacy `svelte-redux-toolkit` installs)
- `.agents/skills/migrate-to-svelte-redux-toolkit` (legacy `svelte-redux-toolkit` installs)
- `.agents/skills/svelte/setup` (legacy setup path from older package versions)
- `.agents/skills/svelte/migration` (legacy setup path from older package versions)

Do not delete `.agents/skills` as a whole unless you are certain it contains no project or third-party skills you want to keep.

## 5. Maintainer source-checkout validation

These commands are for maintainers working from a source checkout, not for consumer projects:

```bash
pnpm install --frozen-lockfile
node scripts/cli.mjs help
npm run validate:architecture
npm test
npm run build
npm run validate:release
```

Use the repository's `pnpm-lock.yaml` for a clean dependency baseline. Do not substitute consumer `npx themis` install, cleanup, or uninstall commands for release validation; those commands exercise a downstream app workflow and write under the consuming project's `.agents/` and `.claude/` paths.

Run `npm run validate:architecture` before accepting or releasing changes that
touch Redux state, actions, selectors, sagas, or the skills/docs governing those areas. A
passing architecture gate exits 0 and prints
`[architecture-validation] no architecture gate violations found`; any listed
violation must be fixed or justified with the documented gate ignore comments
before release validation can pass.