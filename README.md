# git-worktree-pool

`wtp` manages a pool of reusable git worktrees next to your clone. It gives a branch a free slot, takes the slot back when you are done, and moves your shell between slots. It has a keyboard TUI and plain commands.

## Layout

```
my-repo/                    slot 0, your clone
my-repo-wt-pool/
  .my-repo-wt-3             marker: slot 3 is free
  my-repo-wt-1/             slot 1
  my-repo-wt-2/             slot 2
  my-repo-wt-3/             slot 3 (free)
```

wtp works from the clone, from the pool folder, and from any slot.

## Install

```bash
npm install -g git-worktree-pool
worktree-pool setup
```

Requirements: Node 22.12 or later, git 2.31 or later.

Run `worktree-pool setup` once. It gives you the `wtp` command, which changes the folder of the shell you type it in. Setup asks before each change. `worktree-pool setup --remove` undoes them.

| Shell | What setup adds |
|---|---|
| cmd, PowerShell 7 | `wtp.cmd` and `wtp.ps1` next to `worktree-pool`. When that folder is locked (nvm for Windows in shim mode), they go to `%LOCALAPPDATA%\Microsoft\WindowsApps`. |
| Windows PowerShell 5.1 | The same `wtp.ps1`. It runs only when the execution policy allows scripts: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| bash, zsh, fish | A `wtp` function in the profile of your `$SHELL` (`~/.bashrc`, `~/.zshrc`, or `~/.config/fish/conf.d/wtp.fish`), and a `wtp` script next to `worktree-pool`. Only the function changes the folder. |
| Git Bash | The same function in `~/.bashrc`, when that file exists or setup runs from Git Bash. |

Without setup, wtp still copies the path to the clipboard, and you paste it. On Windows, `wtp doctor` reports a missing or old setup.

## Commands

| Command | What it does |
|---|---|
| `wtp` | Opens the TUI. Prints the table when the output is not a terminal. |
| `wtp list`, `wtp ls` | Prints the slot table. `--json` prints the data. `--no-changes` skips the change counts. |
| `wtp assign <branch>` | Gives the branch a slot, copies the path, and moves the shell there. `--no-cd` only copies. |
| `wtp switch <index>` | Copies the slot path and moves the shell there. |
| `wtp free <index>` | Asks, then discards uncommitted changes, releases the branch, and marks the slot free. `--yes` skips the question. |
| `wtp delete <index>` | Asks, then removes the slot folder. `--branch` also deletes the local branch. `--force` allows unmerged branches and locked slots. |
| `wtp path <index>` | Prints the slot path. |
| `wtp setup` | Sets up the `wtp` command once. `--remove` undoes it. |
| `wtp doctor` | Reports pool problems and repairs the safe ones. |

### Which slot assign uses

1. The lowest free slot, if there is one. Its ignored files (node_modules, build output) are still there.
2. Else a new slot at the lowest unused index. After you delete slot 2, the next new slot is 2 again.

### Which branch assign uses

1. The local branch with that name.
2. Else the branch on the remote (`origin`), tracked.
3. Else a new branch from your local `main`. wtp does not fetch `main` first. Rebase the slot yourself when `main` moves on.

## TUI keys

| Key | Action |
|---|---|
| `↑` `↓`, `k` `j` | Move the selection |
| `0`-`9` | Jump to a slot index |
| `Enter` | Copy the path, move the shell there, and exit |
| `a` | Assign a branch (fuzzy suggestions from local and remote branches) |
| `f` | Free the slot |
| `d` | Delete the slot (space toggles "also delete the branch") |
| `c` | Copy the path |
| `/` | Filter by branch |
| `r` | Refresh |
| `?` | Help |
| `q`, `Esc` | Quit without moving the shell |

## Settings

wtp reads git config, so per-repo settings live in `.git/config`:

| Key | Default | Meaning |
|---|---|---|
| `wtp.base` | `main` | The local branch that new branches start from |
| `wtp.remote` | `origin` | The remote that assign looks at |

## Notes

* On Windows, wtp can't delete the slot your shell is in. Run `wtp switch 0` first.
* Slot 0 is your clone. wtp never frees or deletes it.
* Free and delete always say what they discard before they ask.

## Development

Run `npm run typecheck`, `npm run eslint`, and `npm test` before you commit. `npm run test:e2e` installs the packed package for real and runs real shells, so only CI runs it. On a machine with a Node version manager in shim mode (nvm for Windows), it could write into your own global install.

## Dependencies

Every package passed a Snyk `snyk_package_health_check` before it was added. Versions are at least 14 days old (the repo's `.npmrc` sets `min-release-age=14`).

| Package | Version | Kind | Snyk rating | Notes |
|---|---|---|---|---|
| @typescript/native | `npm:typescript@7.0.2` | dev | Healthy | The Go-native compiler behind `tsc` (build and typecheck); ships the platform binary `@typescript/typescript-<os>-<arch>` (Windows x64 package: Healthy). Approved by the owner. |
| typescript | `npm:@typescript/typescript6@6.0.2` | dev | Healthy | TypeScript 6 under the `typescript` name, for the JS API that typescript-eslint needs (TypeScript 7 has none). Adds a `tsc6` bin. Same pattern as fix-lockfile-integrity. |
| eslint | 10.11.0 | dev | Healthy (10.11.0 itself: no Snyk data yet) | 10.12.0 was under the 14-day release age. Approved by the owner. |
| @eslint/js | 10.0.1 | dev | Healthy | |
| @typescript-eslint/eslint-plugin, @typescript-eslint/parser | 8.71.0 | dev | Healthy (8.71.0 itself: no Snyk data yet) | 8.71.2 was under the 14-day release age. Approved by the owner. |
| eslint-plugin-import-x | 4.17.1 | dev | Healthy | |
| eslint-import-resolver-typescript | 4.4.5 | dev | Healthy | Pulls in unrs-resolver 1.12.2 (Healthy), which ships Rust native bindings (win32-x64-msvc, linux-x64-gnu, darwin-arm64: Healthy). npm skips its postinstall; the binding comes as an optional dependency. Approved by the owner. |
| eslint-plugin-n | 18.4.0 | dev | Healthy (18.4.0 itself: no Snyk data yet) | 18.4.1 was under the 14-day release age. Approved by the owner. |
| eslint-plugin-security | 4.2.0 | dev | Healthy | |
| globals | 17.13.0 | dev | Healthy | |
| vitest | 5.0.3 | dev | Healthy | Needs Node `^22.12 \|\| ^24 \|\| >=26`. |
| vite | 8.3.2 | dev (vitest peer) | Healthy | Pulls in rolldown and lightningcss, which ship Rust native bindings (both Healthy). Approved by the owner. |
| rolldown | 1.2.12 | dev (via vite) | Healthy | Pinned with `overrides`: the newest version Snyk assessed for the Windows binding. |
| @types/node | 24.6.0 | dev | Healthy | 26.6.x had no Snyk assessment yet; 24.x is close to the Node 22.12 minimum. |
| ink | 7.1.1 | runtime | Healthy | 8.0.0 was under the 14-day release age. Needs Node >=22. |
| react | 19.3.0 | runtime | Healthy | |
| yoga-layout | 3.2.1 | runtime (via ink) | Review recommended | Only finding: inactive maintenance (no release since 2024-12). No known vulnerabilities. Ships WebAssembly. Approved by the owner. |
| @types/react | 19.3.0 | dev | Healthy | |
| ink-testing-library | 4.0.0 | dev | Healthy | |
