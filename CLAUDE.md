# git-worktree-pool

npm CLI + Ink TUI (`wtp`) that hands out reusable git worktrees next to a clone and moves the caller's shell into them.

## Checks

* `npm run type-check`, `npm run eslint`, `npm test` - run all three before you report work done.
* `npm run test:e2e` - CI only. It installs the packed package globally; under nvm for Windows that writes into the owner's real global install.
* Test launchers in temp folders, as `tests/platform/launcher-run.test.ts` does. Run `npm i -g` or `worktree-pool setup` here only when the owner asks.
* `inst.bat` is the owner's local install script. It stays untracked.

## Tooling

* TypeScript through two npm aliases: `@typescript/native` (TS 7, the `tsc` for build and type-check) and `typescript` (TS 6, the JS API that typescript-eslint needs).
* ESLint flat config (`eslint.config.mjs`): typescript-eslint, import-x, n, security.
* Vitest (`vitest.config.ts`, `vitest.e2e.config.ts`); Ink + React for the TUI.

## How the shell moves

* A child process can't change its parent shell's folder. `worktree-pool` writes the target folder to the file in `WTP_CWD_FILE`; the launcher that called it does the `cd`.
* `package.json` has one bin, `worktree-pool`. `worktree-pool setup` writes `wtp.cmd`, `wtp.ps1` and `wtp` (sh) from `launchers/`. A `wtp` bin is wrong: nvm shim mode, Volta and scoop turn it into `wtp.exe`, and an .exe beats a .cmd.
* bash/zsh/fish move through a profile function (`worktree-pool init <shell>`); the sh launcher can't.
* The launchers and the profile function also set `WTP_SHELL`. It picks the shell that runs `.superset` setup and teardown scripts.
* Rejected, do not re-propose: postinstall scripts, registry/AutoRun/doskey, changing nvm config, assuming nvm exists.

## Gotchas

* `.gitattributes` pins CRLF for `launchers/wtp.cmd` and `wtp.ps1`, and LF for `launchers/wtp` and `src/bin/wtp.ts`. A CRLF shebang breaks `n/hashbang` on Windows CI.
* `src/bin/wtp.ts` keeps its `#!/usr/bin/env node` shebang. Without it, npm's shim opens `dist/bin/wtp.js` in an editor. `tests/bin.test.ts` guards it.
* In `wtp.cmd`: `chcp` and `set /p` stay outside `( )` blocks, and batch files need `call`.
* A Windows PowerShell 5.1 started from pwsh (every GitHub Windows step) inherits pwsh's `PSModulePath` and cannot load `Microsoft.PowerShell.Utility` cmdlets such as `New-TemporaryFile`. Keep `wtp.ps1` to .NET calls and the cmdlets it uses now; `tests/platform/launcher-run.test.ts` runs 5.1 with pwsh's `PSModulePath` to catch this.
* PowerShell tests write their result to a UTF-8 file, not stdout, so the console code page cannot change it.
* Changing a launcher's content means raising `LAUNCHER_VERSION` and the `wtp-launcher N` marker in all three files. Setup replaces only launchers older than that number.
* Edit the CRLF launchers with an editor or node, never `sed -i`: Git Bash's sed strips the `\r`.
* Plain CLI output is ASCII: `src/ui/glyphs.ts` `PLAIN_GLYPHS` is the default. Only the Ink TUI passes `TUI_GLYPHS`.
* The Bash tool mangles backslash paths passed to cmd/powershell. Drive real-console checks with a `.ps1` file or `-EncodedCommand`.

## Dependencies

* Pins lag the newest release: `.npmrc` sets `min-release-age=14`. Raise a pin when the release is old enough and Snyk has assessed it.
* Owner-approved native code: the `@typescript/native` platform binary, unrs-resolver (via eslint-import-resolver-typescript), rolldown and lightningcss (via vite), yoga-layout WebAssembly (via ink).
* yoga-layout rates "Review recommended" in Snyk for inactive maintenance only, with no known vulnerabilities. The owner approved it.
* `overrides.rolldown` pins the newest version Snyk assessed for the Windows binding.

## Release

* CI (`.github/workflows/nodejs.yml`) runs on pull requests to `main` and on tags, not on pushes to `main`.
* To release: set `version` in `package.json`, push tag `v<version>`. The publish job smoke-tests a global install on Windows, publishes with provenance, and creates the GitHub release.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default role strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), kept as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
