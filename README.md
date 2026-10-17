# git-worktree-pool

Work on several branches at once, without a fresh install and build for each one.

## Why

Switching branches in one clone means stashing your work and rebuilding. A separate `git worktree` per branch avoids that, but each new worktree starts empty: you run `npm install` and the build again, and old folders pile up.

`wtp` keeps a pool of worktrees next to your clone and reuses them. When you finish a branch, wtp frees its slot. The next branch gets that slot with its `node_modules` and build output still in place. wtp also moves your shell into the slot, so you can start work at once.

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
| `wtp assign <branch>` | Gives the branch a slot, copies the path, and moves the shell there. `--no-cd` only copies. When the branch is already in a slot, wtp offers to switch there. |
| `wtp switch <index>` | Copies the slot path and moves the shell there. |
| `wtp free <index>` | Asks, then discards uncommitted changes, releases the branch, and marks the slot free. `--yes` skips the question. `--force` frees a locked slot. |
| `wtp delete <index>` | Asks, then discards uncommitted changes and removes the slot folder. `--yes` skips the question. `--branch` also deletes the local branch. `--force` allows unmerged branches and locked slots. |
| `wtp path <index>` | Prints the slot path. |
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

## Notes

* Slot 0 is your clone. wtp never frees or deletes it.
* Free and delete always say what they discard before they ask.
* On Windows, wtp can't delete the slot your shell is in. Run `wtp switch 0` first.
