import type { Io } from "../io.js";
import type { Args } from "../main.js";

const HELP = `wtp - a pool of reusable git worktrees

Usage:
  wtp                        open the TUI (plain list when not in a terminal)
  wtp list | ls              print the slot table  [--json] [--no-changes]
  wtp assign <branch>        give a branch a slot, copy its path, cd to it  [--no-cd] [--no-setup]
  wtp switch <index|branch>  copy the slot path and cd to it
  wtp free <index>           reset a slot and mark it free  [--yes] [--force] [--no-teardown]
  wtp delete <index>         remove a slot  [--yes] [--branch] [--force] [--no-teardown]
  wtp path <index|branch>    print a slot path
  wtp setup                  set up the wtp command for your shells, once  [--yes] [--remove]
  wtp doctor                 report and repair pool problems
  wtp help | --help          show this help
  wtp --version              print the version

A branch name must match exactly. Digits always mean a slot index.

worktree-pool is the same program, but only wtp can change the shell's folder.
First time: run "worktree-pool setup" once to get the wtp command.
`;

export async function helpCommand(_args: Args, io: Io): Promise<number> {
    io.stdout.write(HELP);
    return 0;
}
