import { initScript, parseShell } from "../../platform/shell-init.js";
import type { Io } from "../io.js";
import type { Args } from "../main.js";

// Plumbing for the profile line that "worktree-pool setup" writes. Shells run it at every start,
// so this path must not import Ink.
export async function initCommand(args: Args, io: Io): Promise<number> {
    io.stdout.write(initScript(parseShell(args.positionals[0])));
    return 0;
}
