# Contributing to themis

Thanks for your interest in contributing! This document covers how to set up the project, run the checks, and submit changes.

## Setup

This project uses [pnpm](https://pnpm.io/) as its package manager:

```bash
pnpm install --frozen-lockfile
```

## Running Tests

Tests are written with [Vitest](https://vitest.dev/):

```bash
pnpm vitest run
```

## Required Checks

Before opening a pull request, make sure the following pass:

```bash
# Run the test suite
pnpm vitest run

# Validate architecture rules (import boundaries, layering)
node scripts/validate-architecture.mjs

# Validate release readiness (package exports, build artifacts)
node scripts/validate-release.mjs
```

## Skills

The `skills/` directory contains agent skill files. Pull requests that touch `skills/` are checked by the **Validate Skills** GitHub Actions workflow (`.github/workflows/validate-skills.yml`), which verifies frontmatter, that skill names match their paths, and that files stay under the 500-line limit.

## Architecture

Before making changes, read the guides in [`docs/`](./docs/) — they cover stores, selectors, reducers, sagas, and the public import boundaries that `validate-architecture.mjs` enforces.

## Submitting Changes

1. Fork the repository and create a branch for your change.
2. Keep changes focused; follow the existing code style and patterns documented in `docs/`.
3. Add or update tests for any behavior change.
4. Run the required checks listed above.
5. Open a pull request with a clear description of the change.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

