import type { Context } from "../core/context.js";
import { isInside } from "../core/naming.js";
import { loadPool } from "../core/pool.js";
import { handoffCwd } from "../platform/cwd.js";
import { findLauncher, realFs, type FsDeps } from "../platform/launchers.js";
import { hasIntegration, sessionShell } from "../platform/shell-init.js";
import { renderPlainTable } from "./commands/list.js";
import type { Io } from "./io.js";

export const SETUP_HINT =
  "! wtp can't change this shell's folder yet. Run \"worktree-pool setup\" once to get the wtp command, which changes the folder.\n";
export const USE_WTP_HINT = "! Run \"wtp\" instead of \"worktree-pool\" to change the folder.\n";
export const FUNCTION_HINT =
  "! A script can't change this shell's folder. Run \"worktree-pool setup\" once to add the wtp function to your shell profile.\n";

// Which hint fits when WTP_CWD_FILE is not set. The sh launcher marks itself with WTP_VIA=sh.
// Setup is done when a launcher exists (Windows) or the profile has the wtp function (POSIX, Git Bash).
export async function cdHint(io: Pick<Io, "platform" | "env" | "home">, fs: FsDeps = realFs): Promise<string> {
    if (io.env.WTP_VIA === "sh") return FUNCTION_HINT;
    if (io.platform === "win32" && findLauncher({ platform: io.platform, env: io.env, fs })) return USE_WTP_HINT;
    const shell = sessionShell(io.platform, io.env, io.home);
    if (shell && (await hasIntegration(shell, io))) return USE_WTP_HINT;
    return SETUP_HINT;
}

export async function moveShellTo(dir: string, io: Io, opts: { copy: boolean; cd: boolean }): Promise<void> {
    if (opts.copy) {
        const result = await io.copy(dir);
        io.stderr.write(result === "failed" ? `path: ${dir}\n` : `copied ${dir}\n`);
    }
    if (!opts.cd) return;
    if (await handoffCwd(dir, io.env)) return;
    if (!opts.copy) io.stderr.write(`go to: ${dir}\n`);
    io.stderr.write(await cdHint(io));
}

// After free or delete: leave the slot when the shell is in it, then print the table from where the shell ends up.
export async function showPoolAfter(ctx: Context, slotDir: string, io: Io): Promise<void> {
    const inside = isInside(ctx.cwd, slotDir, ctx.platform);
    if (inside) await moveShellTo(ctx.root, io, { copy: false, cd: true });
    io.stdout.write(renderPlainTable(await loadPool({ ...ctx, cwd: inside ? ctx.root : ctx.cwd }, { changes: true }), io));
}
