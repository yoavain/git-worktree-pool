import { rename, rm } from "node:fs/promises";
import type { Context } from "./context.js";
import { GitError, UserError } from "./errors.js";
import { runGit, tryGit } from "./git.js";
import { withPoolLock } from "./lock.js";
import { markerPath } from "./naming.js";
import { findSlot, loadPool, PROBLEM_MISSING, PROBLEM_ORPHAN_MARKER, PROBLEM_UNREGISTERED } from "./pool.js";

export interface DeleteOptions {
  discard?: boolean;
  unlock?: boolean;
  deleteBranch?: false | "safe" | "force";
}

export interface DeleteResult {
  index: number;
  path: string;
  branch: string | null;
  branchDeleted: boolean;
  warnings: string[];
}

const LOCKED_FILES = /permission denied|resource busy|being used by another process|directory not empty|invalid argument/i;

const heldMessage = (dir: string, index: number) =>
    `Could not delete ${dir}. A program holds files in it (an editor, a terminal, or a dev server). Close it and run wtp delete ${index} again.`;

/**
 * On Windows a folder can't be renamed while any process has a file or its cwd in it.
 * Probe with a rename and rename it back, so wtp refuses before git deletes anything:
 * once `git worktree remove` starts deleting, it unregisters the worktree even when files stay behind.
 */
async function assertNotHeld(dir: string, index: number): Promise<void> {
    const probe = `${dir}.wtp-probe-${process.pid}`;
    try {
        await rename(dir, probe);
    }
    catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "EBUSY" || code === "EACCES") throw new UserError(heldMessage(dir, index));
        throw e;
    }
    await rename(probe, dir);
}

async function removeWorktree(ctx: Context, dir: string, index: number, opts: DeleteOptions): Promise<void> {
    if (process.platform === "win32") await assertNotHeld(dir, index);
    // git needs --force once for a dirty worktree and twice for a locked one.
    const forces = opts.unlock ? 2 : opts.discard ? 1 : 0;
    const args = ["worktree", "remove", ...Array<string>(forces).fill("--force"), dir];
    const r = await tryGit(args, ctx.root);
    if (r.ok) return;
    if (/contains modified or untracked files/i.test(r.stderr)) {
        throw new UserError(`Slot ${index} has uncommitted changes. Confirm the discard, or pass --force.`);
    }
    if (!LOCKED_FILES.test(r.stderr)) throw new GitError(args, r.code, r.stderr);
    // git has already unregistered the worktree and deleted part of it. Finish the job if the files are free now.
    try {
        await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
    catch {
        throw new UserError(`git removed slot ${index}, but files in ${dir} are still in use. Close the program that holds them, then delete the folder by hand.`);
    }
}

export async function deleteSlot(ctx: Context, index: number, opts: DeleteOptions = {}): Promise<DeleteResult> {
    if (index === 0) throw new UserError("Slot 0 is the clone. wtp never deletes it.");

    return withPoolLock(ctx.poolRoot, async () => {
        const slot = findSlot(await loadPool(ctx), index);
        if (!slot) throw new UserError(`There is no slot ${index}.`);
        if (slot.problem === PROBLEM_UNREGISTERED) {
            throw new UserError(`${slot.path} is not a registered worktree. wtp does not delete it. Check what it holds and remove it by hand.`);
        }
        if (slot.locked && !opts.unlock) throw new UserError(`Slot ${index} is locked by git worktree lock. Pass --force to delete it.`);

        const branch = slot.state === "active" ? slot.branch : null;
        if (slot.problem === PROBLEM_MISSING) await runGit(["worktree", "prune"], ctx.root);
        else if (slot.problem !== PROBLEM_ORPHAN_MARKER) await removeWorktree(ctx, slot.path, index, opts);
        await rm(markerPath(ctx.poolRoot, ctx.repoName, index), { force: true });
        await tryGit(["worktree", "prune"], ctx.root);

        const warnings: string[] = [];
        let branchDeleted = false;
        if (branch && opts.deleteBranch) {
            const r = await tryGit(["branch", opts.deleteBranch === "force" ? "-D" : "-d", branch], ctx.root);
            if (r.ok) branchDeleted = true;
            else warnings.push(`wtp kept the branch ${branch}, because it is not merged. Use --force to delete it anyway.`);
        }
        return { index, path: slot.path, branch, branchDeleted, warnings };
    });
}
