import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { findCheckout, resolveBranch, type BranchPlan } from "./branch.js";
import { readConfig, type WtpConfig } from "./config.js";
import type { Context } from "./context.js";
import { BranchInUseError } from "./errors.js";
import { runGit } from "./git.js";
import { withPoolLock } from "./lock.js";
import { markerPath, slotPath } from "./naming.js";
import { chooseSlot, loadPool, repairPool } from "./pool.js";

export interface AssignResult {
  index: number;
  path: string;
  reused: boolean;
  plan: BranchPlan;
  createdPoolRoot: boolean;
  warnings: string[];
}

function switchArgs(plan: BranchPlan): string[] {
    switch (plan.kind) {
        case "local":
            return ["switch", plan.name];
        case "remote":
            return ["switch", "--track", "-c", plan.name, `${plan.remote}/${plan.name}`];
        case "new":
            return ["switch", "-c", plan.name, plan.base];
    }
}

function worktreeAddArgs(plan: BranchPlan, dir: string): string[] {
    switch (plan.kind) {
        case "local":
            return ["worktree", "add", dir, plan.name];
        case "remote":
            return ["worktree", "add", "--track", "-b", plan.name, dir, `${plan.remote}/${plan.name}`];
        case "new":
            return ["worktree", "add", "-b", plan.name, dir, plan.base];
    }
}

export async function assign(ctx: Context, name: string, opts: { config?: WtpConfig } = {}): Promise<AssignResult> {
    const cfg = opts.config ?? (await readConfig(ctx.root));
    const createdPoolRoot = !existsSync(ctx.poolRoot);

    return withPoolLock(ctx.poolRoot, async () => {
        await repairPool(ctx);
        const pool = await loadPool(ctx);
        const inUse = findCheckout(pool, name);
        if (inUse) throw new BranchInUseError(name, inUse.index, inUse.path);

        const { plan, warning } = await resolveBranch(ctx, name, cfg);
        const { index, reuse } = chooseSlot(pool);
        const dir = slotPath(ctx.poolRoot, ctx.repoName, index);

        if (reuse) {
            await runGit(switchArgs(plan), dir);
            await rm(markerPath(ctx.poolRoot, ctx.repoName, index), { force: true });
        }
        else {
            await runGit(worktreeAddArgs(plan, dir), ctx.root);
        }

        return { index, path: dir, reused: reuse, plan, createdPoolRoot, warnings: warning ? [warning] : [] };
    });
}
