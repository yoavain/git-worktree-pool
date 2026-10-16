import { writeFile } from "node:fs/promises";
import type { Context } from "./context.js";
import { UserError } from "./errors.js";
import { runGit, tryGit } from "./git.js";
import { withPoolLock } from "./lock.js";
import { markerPath } from "./naming.js";
import { parseStatusV2 } from "./parse.js";
import { findSlot, loadPool } from "./pool.js";

export interface SlotInspection {
  branch: string | null;
  modified: number;
  untracked: number;
  unpushed: number | null;
}

export interface FreeResult {
  index: number;
  path: string;
  alreadyFree: boolean;
}

export async function inspectSlot(dir: string): Promise<SlotInspection> {
    const s = parseStatusV2(await runGit(["status", "--porcelain=v2", "--branch"], dir));
    const remotes = (await runGit(["remote"], dir)).trim();
    let unpushed: number | null = null;
    if (remotes && s.head) {
        const r = await tryGit(["rev-list", "--count", "HEAD", "--not", "--remotes"], dir);
        if (r.ok) unpushed = Number(r.stdout.trim());
    }
    return { branch: s.head, modified: s.changed, untracked: s.untracked, unpushed };
}

export function describeLoss(info: SlotInspection): string[] {
    const lines: string[] = [];
    if (info.modified || info.untracked) {
        lines.push(`${info.modified} modified and ${info.untracked} untracked files will be discarded.`);
    }
    else {
        lines.push("No uncommitted changes.");
    }
    if (info.unpushed) {
        lines.push(info.unpushed === 1
            ? "1 commit is not on any remote. The branch keeps it."
            : `${info.unpushed} commits are not on any remote. The branch keeps them.`);
    }
    lines.push("Ignored files (node_modules, build output) stay.");
    return lines;
}

export async function free(ctx: Context, index: number, opts: { force?: boolean } = {}): Promise<FreeResult> {
    if (index === 0) throw new UserError("Slot 0 is the clone. It cannot be freed.");
    return withPoolLock(ctx.poolRoot, async () => {
        const slot = findSlot(await loadPool(ctx), index);
        if (!slot) throw new UserError(`There is no slot ${index}.`);
        if (slot.state === "free") return { index, path: slot.path, alreadyFree: true };
        if (slot.state === "broken") throw new UserError(`Slot ${index} is broken (${slot.problem}). Run wtp doctor.`);
        if (slot.locked && !opts.force) throw new UserError(`Slot ${index} is locked by git worktree lock. Pass --force to free it.`);

        await runGit(["reset", "--hard", "--quiet"], slot.path);
        await runGit(["clean", "-fd", "--quiet"], slot.path);
        await runGit(["switch", "--detach", "--quiet"], slot.path);
        await writeFile(markerPath(ctx.poolRoot, ctx.repoName, index), "");
        return { index, path: slot.path, alreadyFree: false };
    });
}
