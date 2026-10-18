# git-worktree-pool

Work on several branches at once, without a fresh `npm install` for each one.

## Why

`git worktree add` gives you a second checkout of a branch in seconds. In a large monorepo, though, the checkout is not where the time goes. A new worktree has no `node_modules`, so you run `npm install` there, and that can take a long time.

It is worst on Windows. Antivirus and other IT security tools there often check each file as it is written and hold the write until the check ends, so writing the many files of `node_modules` is slow. On macOS, some of these tools check files after they are written, so the same install finishes sooner.

`wtp` keeps a pool of worktrees next to your clone and reuses them, so you pay for that install once per slot, not once per branch. When you finish a branch, wtp frees its slot: it discards the branch's changes but keeps the ignored files, such as `node_modules` and build output. The next branch gets that slot with its dependencies already in place, and a later `npm install` there only has to apply the difference. wtp also moves your shell into the slot, so you can start work at once.

## Install

```bash
npm install -g git-worktree-pool
worktree-pool setup
```

Requirements: Node 22.12 or later, git 2.31 or later.

`worktree-pool setup` gives you the `wtp` command, which moves the shell you type it in. Setup asks before each change. `worktree-pool setup --remove` undoes them.

* **cmd and PowerShell:** `wtp` works right after setup. Windows PowerShell 5.1 also needs scripts allowed: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
* **bash, zsh, fish, Git Bash:** setup adds a `wtp` function to your shell profile. Open a new shell to use it.

Without setup, wtp still copies the slot path to the clipboard, and you paste it.

## Quick start

```bash
cd my-repo
wtp assign my-feature   # gives the branch a slot and moves you there
wtp switch 0            # back to your clone
wtp free 1              # done with slot 1: it is free for the next branch
wtp                     # or do all of this from the TUI
```

The pool sits next to your clone:

```
my-repo/                    slot 0, your clone
my-repo-wt-pool/
  my-repo-wt-1/             slot 1
  my-repo-wt-2/             slot 2
```

wtp works from the clone, from the pool folder, and from any slot.

## Commands

| Command | What it does |
|---|---|
| `wtp` | Opens the TUI. |
| `wtp list`, `wtp ls` | Prints the slot table. `--json` prints the data. `--no-changes` skips the change counts. |
| `wtp assign <branch>` | Gives the branch a slot, copies the path, and moves the shell there. `--no-cd` only copies. `--no-setup` skips the setup script. When the branch is already in a slot, wtp offers to switch there. |
| `wtp switch <index\|branch>` | Copies the slot path and moves the shell there. A branch name must match exactly. It also reaches a worktree outside the pool. |
| `wtp free <index>` | Asks, then discards uncommitted changes, releases the branch, and marks the slot free. `--yes` skips the question. `--force` frees a locked slot. `--no-teardown` skips the teardown script. |
| `wtp delete <index>` | Asks, then discards uncommitted changes and removes the slot folder. `--yes` skips the question. `--branch` also deletes the local branch. `--force` allows unmerged branches and locked slots. `--no-teardown` skips the teardown script. |
| `wtp path <index\|branch>` | Prints the slot path. |
| `wtp doctor` | Reports pool problems and repairs the safe ones. |

`assign` takes the lowest free slot, or makes a new one. For the branch, it uses the local branch, else the branch on `origin`, else a new branch from your local `main`. wtp does not fetch `main` first.

## TUI keys

| Key | Action |
|---|---|
| `↑` `↓`, `k` `j` | Move the selection |
| `0`-`9` | Jump to a slot index |
| `Enter` | Move the shell to the slot and exit |
| `a` | Assign a branch. The suggestions leave out branches that a worktree already has. The TUI stays open with the new slot selected; Enter goes there. |
| `f` | Free the slot |
| `d` | Delete the slot |
| `c` | Copy the path |
| `/` | Filter by branch |
| `?` | Help |
| `q`, `Esc` | Quit. If you freed or deleted the slot you are in, quit moves you to the clone. |

## Settings

Per-repo settings live in git config:

| Key | Default | Meaning |
|---|---|---|
| `wtp.base` | `main` | The branch that new branches start from |
| `wtp.remote` | `origin` | The remote that assign looks at |

For example: `git config wtp.base develop`.

## Setup and teardown scripts

wtp runs a repo's [Superset](https://docs.superset.sh/setup-teardown-scripts) scripts, so one `.superset/` folder serves both tools. A minimal `.superset/config.json`:

```json
{ "setup": ["npm install"] }
```

| Event | Runs |
|---|---|
| `assign` (new or reused slot) | `setup`, after the branch is checked out |
| `free`, `delete` of an active slot | `teardown`, before wtp frees or removes the slot |

* wtp joins the commands with `&&` and runs them in the shell you called wtp from: cmd, PowerShell, bash, zsh or fish. A team on several systems should write `npm run <script>` and keep the logic in `package.json`.
* Without a `setup` or `teardown` key, wtp runs `.superset/setup.sh` or `teardown.sh` through bash (Git Bash on Windows).
* The scripts get `SUPERSET_ROOT_PATH` (the clone), `SUPERSET_WORKSPACE_NAME` (the branch), `SUPERSET_WORKSPACE_PATH` (the slot), and `WTP_SLOT` (the slot index).
* If setup fails, the slot stays assigned and wtp still moves you there. `wtp assign` then exits with code 4.
* If teardown fails, wtp warns and frees or deletes the slot anyway. The TUI asks first. Teardown stops after 60 seconds.
* `--no-setup` and `--no-teardown` skip the scripts.
* The user override (`~/.superset/projects/<repo path>/config.json`) and `config.local.json` work as in Superset. On Windows, the drive letter has no colon: `~/.superset/projects/C/Dev/my-repo/config.json`.
* A reused slot keeps ignored files, so a personal `.superset/config.local.json` left in a slot also applies to the next branch there.
* The shell rule needs the current launchers. After an update, run `worktree-pool setup` again; `wtp doctor` says when a launcher is old. With an old launcher, wtp uses cmd on Windows and `$SHELL` elsewhere.

## Notes

* Slot 0 is your clone. wtp never frees or deletes it.
* Free and delete always say what they discard before they ask.
* On Windows, wtp can't delete the slot your shell is in. Run `wtp switch 0` first.
