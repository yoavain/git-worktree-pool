# Contributing

:+1::tada: First off, thanks for taking the time to contribute! :tada::+1:

The following is a set of guidelines for contributing to git-worktree-pool.
These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## Code of Conduct

This project and everyone participating in it is governed by a [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How to contribute to git-worktree-pool

1. Open an [issue](https://github.com/yoavain/git-worktree-pool/issues) for a bug or a feature request.
2. Fork the repository and create a branch from `main`.
3. Make your change and add tests for it.
4. Open a pull request to `main`. CI runs on each pull request.

### Setup

```bash
npm ci
```

`.npmrc` sets `min-release-age=14`. A new dependency version must be at least 14 days old.

### Tests

Make sure the code you're adding has decent test coverage.

Run all three checks before you open a pull request:

```bash
npm run type-check
npm run eslint
npm test
```

Do not run `npm run test:e2e` on your computer. It installs the packed package globally. CI runs it.

### Launchers

The files in `launchers/` are the `wtp` shell wrappers that `worktree-pool setup` writes.

* When you change a launcher, raise `LAUNCHER_VERSION` in `src/platform/launchers.ts`.
* Raise the `wtp-launcher N` marker in all three launcher files to the same number.
* `.gitattributes` sets the line endings of each launcher. Do not change them.

### Commit Guidelines

The project uses ESLint for standardizing code style. Run `npm run eslint:fix` to fix the issues that ESLint can fix.
