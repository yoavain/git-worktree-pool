import { writeFile } from "node:fs/promises";
import type { Context } from "./context.js";
import { UserError } from "./errors.js";
import { runGit, tryGit } from "./git.js";
import { withPoolLock } from "./lock.js";
import { markerPath } from "./naming.js";
import { parseStatusV2 } from "./parse.js";
import { loadPool, problemLabel, requireSlot, type Slot } from "./pool.js";

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

// The refusals that need no lock. The command layer runs them before teardown, so a refusal comes first.
export function assertFreeable(slot: Slot, index: number, force: boolean): void {
    if (slot.state === "broken") throw new UserError(`Slot ${index} is broken (${problemLabel(slot.problem)}). Run wtp doctor.`);
    if (slot.locked && !force) throw new UserError(`Slot ${index} is locked by git worktree lock. Pass --force to free it.`);
}

// Teardown runs outside the lock. After it, the slot must still hold the branch that the teardown saw.
export function assertUnchanged(slot: Slot, index: number, expectBranch: string | null | undefined): void {
    if (expectBranch === undefined) return;
    if (slot.state !== "active" || slot.branch !== expectBranch) {
        throw new UserError(`Slot ${index} changed while its teardown ran. Nothing else changed.`);
    }
}

export async function free(ctx: Context, index: number, opts: { force?: boolean; expectBranch?: string | null } = {}): Promise<FreeResult> {
    return withPoolLock(ctx.poolRoot, async () => {
        const slot = requireSlot(await loadPool(ctx), index, "free");
        assertUnchanged(slot, index, opts.expectBranch);
        if (slot.state === "free") return { index, path: slot.path, alreadyFree: true };
        assertFreeable(slot, index, Boolean(opts.force));

        await runGit(["reset", "--hard", "--quiet"], slot.path);
        await runGit(["clean", "-fd", "--quiet"], slot.path);
        await runGit(["switch", "--detach", "--quiet"], slot.path);
        await writeFile(markerPath(ctx.poolRoot, ctx.repoName, index), "");
        return { index, path: slot.path, alreadyFree: false };
    });
}
