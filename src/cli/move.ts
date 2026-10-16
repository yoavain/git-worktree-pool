import type { BranchPlan } from "../core/branch.js";
import { handoffCwd } from "../platform/cwd.js";
import { findLauncher, realFs, type FsDeps } from "../platform/launchers.js";
import type { Io } from "./io.js";

export const SETUP_HINT =
  "! wtp can't change this shell's folder yet. Run \"worktree-pool setup\" once to get the wtp command, which changes the folder.\n";
export const USE_WTP_HINT = "! Run \"wtp\" instead of \"worktree-pool\" to change the folder.\n";
export const FUNCTION_HINT =
  "! A script can't change this shell's folder. Run \"worktree-pool setup\" once to add the wtp function to your shell profile.\n";

// Which hint fits when WTP_CWD_FILE is not set. The sh launcher marks itself with WTP_VIA=sh.
export function cdHint(io: Pick<Io, "platform" | "env">, fs: FsDeps = realFs): string {
    if (io.env.WTP_VIA === "sh") return FUNCTION_HINT;
    if (io.platform === "win32" && findLauncher({ platform: io.platform, env: io.env, fs })) return USE_WTP_HINT;
    return SETUP_HINT;
}

export async function moveShellTo(dir: string, io: Io, opts: { copy: boolean; cd: boolean }): Promise<void> {
    if (opts.copy) {
        const result = await io.copy(dir);
        io.stderr.write(result === "failed" ? `path: ${dir}\n` : `✓ copied ${dir}\n`);
    }
    if (!opts.cd) return;
    if (await handoffCwd(dir, io.env)) return;
    if (!opts.copy) io.stderr.write(`go to: ${dir}\n`);
    io.stderr.write(cdHint(io));
}

export function planLabel(plan: BranchPlan): string {
    switch (plan.kind) {
        case "local":
            return "local";
        case "remote":
            return `from ${plan.remote}`;
        case "new":
            return `new from ${plan.base}`;
    }
}
