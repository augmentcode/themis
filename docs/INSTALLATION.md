# Installation, Cleanup, and Validation

This package has two install contexts with different expectations: consumer apps install it from npm, while maintainers validate this repository from a clean checkout.

## Consumer install

Install just the package in a Svelte 5 project; its `redux`, `redux-saga`, `typed-redux-saga`, and `fast-equals` runtime dependencies ship bundled and are installed automatically:

```bash
npm install @augmentcode/themis
```

`svelte@^5` is the only required peer dependency and is normally already present in a Svelte app. For saga tests that follow this repository's examples, install the optional test helper:

```bash
npm install -D redux-saga-test-plan
```

## Explicit skill copy

Installing `@augmentcode/themis` as a dependency does not copy Skills automatically. Copy or refresh packaged AI skills only when an agent or developer explicitly runs the package maintenance command. In this repository's source checkout, use:

```bash
npm run install:skills
```

The explicit skill installation command:

- changes to the consuming project root before doing any project writes;
- copies the selected packaged AI skill bundle into the consuming project root at `.agents/skills/themis/`, with skill folders directly underneath (root `SKILL.md`, `setup/`, `core/`, `react/`, `svelte/`, `streaming/`);
- if a previous install's `installed-skills.yml` manifest exists there, first removes every file that manifest lists and prunes empty directories, so each install fully refreshes the previous package install (user-authored files not listed in the manifest are preserved);
- writes a fresh `.agents/skills/themis/installed-skills.yml` manifest recording the package name, package version, install target, install timestamp, and the full list of installed relative file paths (the manifest itself is excluded from the list);
- removes package-owned skill copies left directly under the legacy flat `.agents/skills/` location as a one-time migration for existing consumers;
- preserves unrelated project or third-party skills under `.agents/skills/`;
- excludes generated package artifacts such as `skills/_artifacts`;
- no-ops when the package is not installed under a consumer `node_modules` directory;
- logs warnings instead of failing the command.

This keeps package installation side-effect free while still letting humans and AI agents discover and load the same package-specific implementation guidance when requested.

## Consumer package CLI

Consuming apps should run package maintenance commands from the app root after the package has been installed and its bin has been linked. The most direct check is the installed bin path; it should print help immediately. Standard npm package invocation forms are also supported when npm can resolve the installed local bin:

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

Running `npx themis` with no command prints the same help text. Use the domain-specific install command that matches the selected Store family when an agent or developer needs only one package skill bundle:

| Command | Skills copied into `.agents/skills/themis/` |
| --- | --- |
| `npx themis install-skills:react` | root `SKILL.md`, `setup`, `core`, and `react` |
| `npx themis install-skills:svelte` | root `SKILL.md`, `setup`, `core`, and `svelte` |
| `npx themis install-skills:streaming` | root `SKILL.md`, `setup`, `core`, and `streaming` |
| `npx themis install-skills:core` | root `SKILL.md`, `setup`, and `core` |
| `npx themis install-skills` or `npx themis install-skills:all` | the complete all-skills bundle |

Each install command replaces the previous package install in `.agents/skills/themis/` with exactly the selected bundle and writes a fresh `installed-skills.yml` manifest; unrelated project or third-party skills outside that directory, and user-authored files not listed in the manifest, are preserved. Use the all-skills command when the consuming app or repository intentionally needs every package skill family installed. Use `cleanup-skills` to remove the package install before uninstalling; it is manifest-driven and removes only manifest-listed files plus the manifest itself. Maintenance commands print copied, updated, skipped, removed, or no-op output so they should not appear silent. The CLI no longer exposes a `validate-architecture` command (breaking change for consumers that used it); consuming apps get architecture checking by importing one of the exported ESLint domain root configs from `@augmentcode/themis/eslint-plugins` and running ESLint in the app.

If npm package invocation appears to do nothing, verify `./node_modules/.bin/themis` exists in the consuming app and run `./node_modules/.bin/themis help` directly. If that file is missing, the package is not installed or the package manager has not linked its bin in that app; reinstall or repair the local package install before retrying. In this repository's source checkout, `npx`/`npm exec` package-name invocations are not a valid smoke test because the package bin is not linked automatically; use `node scripts/cli.mjs help` for source-checkout validation.

## Explicit cleanup and uninstall

npm 7+ does not run dependency uninstall lifecycle scripts, so uninstalling the package does not automatically remove copied skill files. Run cleanup first, then uninstall:

```bash
npm uninstall @augmentcode/themis
```

The package keeps a manifest-driven cleanup command for the files it installed into `.agents/skills/themis/`:

```bash
npx themis cleanup-skills
# or: npm exec -- themis cleanup-skills
```

That helper removes only the files listed in `.agents/skills/themis/installed-skills.yml`, then the manifest itself, prunes empty directories, and prints a clear no-op message when no manifest exists. It leaves unrelated `.agents/skills` content alone; as a one-time migration it also removes package-owned skill copies left directly under the legacy flat `.agents/skills/` location. Remove optional test dependencies only if your app does not use them elsewhere:

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

## Maintainer validation

Maintainers should validate from the repository root with the committed npm lockfile:

```bash
npm ci
npm run validate:architecture
npm test
npm run build
npm run validate:release
```

Use `npm ci` for a clean local dependency baseline. Do not substitute consumer install or uninstall commands for release validation; those commands exercise a downstream app workflow and may update installed `.agents/skills/themis/` content outside the repository validation path.

Run `npm run validate:architecture` before accepting or releasing changes that
touch Redux state, actions, selectors, sagas, or the skills/docs governing those areas. A
passing architecture gate exits 0 and prints
`[architecture-validation] no architecture gate violations found`; any listed
violation must be fixed or justified with the documented gate ignore comments
before release validation can pass.