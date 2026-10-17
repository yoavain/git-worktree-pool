import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Context } from "./context.js";
import { UserError } from "./errors.js";
import { runGit, tryGit } from "./git.js";
import {
    isInside, lowestUnusedIndex, markerPath, normalizePath, parseMarkerIndex, parseSlotIndex, samePath, slotPath
} from "./naming.js";
import { parseNumstat, parseStatusV2, parseWorktreeList } from "./parse.js";

export type SlotState = "root" | "active" | "free" | "broken";

// Code compares the code; people read the label.
export type SlotProblem = "missing" | "orphan-marker" | "unregistered";

const PROBLEM_LABELS: Record<SlotProblem, string> = {
    "missing": "folder is missing",
    "orphan-marker": "free marker without a worktree",
    "unregistered": "folder is not a registered worktree"
};

export function problemLabel(problem: SlotProblem | undefined): string {
    return problem ? PROBLEM_LABELS[problem] : "unknown problem";
}

export interface Changes {
  added: number;
  removed: number;
  changed: number;
  untracked: number;
  ahead: number;
  behind: number;
}

export interface Slot {
  index: number;
  path: string;
  branch: string | null;
  head: string | null;
  state: SlotState;
  locked: boolean;
  isCurrent: boolean;
  problem?: SlotProblem;
  changes?: Changes | null;
}

export interface ExternalWorktree {
  path: string;
  branch: string | null;
  isCurrent: boolean;
}

export interface Pool {
  ctx: Context;
  slots: Slot[];
  external: ExternalWorktree[];
}

const CHANGES_TIMEOUT_MS = 10_000;

async function readPoolDir(ctx: Context): Promise<{ markers: Set<number>; dirs: Set<number> }> {
    const markers = new Set<number>();
    const dirs = new Set<number>();
    let names: { name: string; isDirectory(): boolean }[];
    try {
        names = await readdir(ctx.poolRoot, { withFileTypes: true });
    }
    catch {
        return { markers, dirs };
    }
    for (const d of names) {
        const m = parseMarkerIndex(ctx.repoName, d.name);
        if (m !== null && !d.isDirectory()) markers.add(m);
        const s = parseSlotIndex(ctx.repoName, d.name);
        if (s !== null && d.isDirectory()) dirs.add(s);
    }
    return { markers, dirs };
}

export async function loadPool(ctx: Context, opts: { changes?: boolean } = {}): Promise<Pool> {
    const entries = parseWorktreeList(await runGit(["worktree", "list", "--porcelain"], ctx.root));
    const { markers, dirs } = await readPoolDir(ctx);
    const slots: Slot[] = [];
    const external: ExternalWorktree[] = [];

    for (const e of entries) {
        const p = normalizePath(e.path);
        if (samePath(p, ctx.root, ctx.platform)) {
            slots.push({ index: 0, path: p, branch: e.branch, head: e.head, state: "root", locked: false, isCurrent: false });
            continue;
        }
        const index = samePath(path.dirname(p), ctx.poolRoot, ctx.platform) ? parseSlotIndex(ctx.repoName, path.basename(p)) : null;
        if (index === null) {
            external.push({ path: p, branch: e.branch, isCurrent: false });
            continue;
        }
        if (e.prunable) {
            slots.push({ index, path: p, branch: e.branch, head: e.head, state: "broken", locked: e.locked, isCurrent: false, problem: "missing" });
        }
        else if (markers.has(index)) {
            slots.push({ index, path: p, branch: null, head: e.head, state: "free", locked: e.locked, isCurrent: false });
        }
        else {
            slots.push({ index, path: p, branch: e.branch, head: e.head, state: "active", locked: e.locked, isCurrent: false });
        }
    }

    const known = new Set(slots.map((s) => s.index));
    for (const index of dirs) {
        if (known.has(index)) continue;
        slots.push({ index, path: slotPath(ctx.poolRoot, ctx.repoName, index), branch: null, head: null, state: "broken", locked: false, isCurrent: false, problem: "unregistered" });
        known.add(index);
    }
    for (const index of markers) {
        if (known.has(index)) continue;
        slots.push({ index, path: slotPath(ctx.poolRoot, ctx.repoName, index), branch: null, head: null, state: "broken", locked: false, isCurrent: false, problem: "orphan-marker" });
    }
    slots.sort((a, b) => a.index - b.index);

    const candidates: { path: string; mark(): void }[] = [
        ...slots.filter((s) => s.state !== "broken").map((s) => ({ path: s.path, mark: () => {
            s.isCurrent = true;
        } })),
        ...external.map((x) => ({ path: x.path, mark: () => {
            x.isCurrent = true;
        } }))
    ];
    candidates.sort((a, b) => b.path.length - a.path.length);
    candidates.find((c) => isInside(ctx.cwd, c.path, ctx.platform))?.mark();

    const pool: Pool = { ctx, slots, external };
    return opts.changes ? withChanges(pool) : pool;
}

export async function readChanges(dir: string): Promise<Changes | null> {
    const [status, numstat] = await Promise.all([
        tryGit(["status", "--porcelain=v2", "--branch"], dir, { timeoutMs: CHANGES_TIMEOUT_MS }),
        tryGit(["diff", "--numstat", "HEAD"], dir, { timeoutMs: CHANGES_TIMEOUT_MS })
    ]);
    if (!status.ok) return null;
    const s = parseStatusV2(status.stdout);
    const n = numstat.ok ? parseNumstat(numstat.stdout) : { added: 0, removed: 0 };
    return { added: n.added, removed: n.removed, changed: s.changed, untracked: s.untracked, ahead: s.ahead, behind: s.behind };
}

export async function withChanges(pool: Pool): Promise<Pool> {
    const slots = await Promise.all(pool.slots.map(async (s) =>
        s.state === "root" || s.state === "active" ? { ...s, changes: await readChanges(s.path) } : s));
    return { ...pool, slots };
}

export function findSlot(pool: Pool, index: number): Slot | undefined {
    return pool.slots.find((s) => s.index === index);
}

export type SlotAction = "free" | "delete";

export function cloneRefusal(action: SlotAction): string {
    return action === "free" ? "Slot 0 is the clone. It cannot be freed." : "Slot 0 is the clone. wtp never deletes it.";
}

// The one place that refuses slot 0 and a missing slot, for the CLI, the TUI, and core.
export function requireSlot(pool: Pool, index: number, action: SlotAction): Slot {
    if (index === 0) throw new UserError(cloneRefusal(action));
    const slot = findSlot(pool, index);
    if (!slot) throw new UserError(`There is no slot ${index}.`);
    return slot;
}

export function chooseSlot(pool: Pool): { index: number; reuse: boolean } {
    const free = pool.slots.filter((s) => s.state === "free").map((s) => s.index).sort((a, b) => a - b);
    if (free.length > 0) return { index: free[0]!, reuse: true };
    return { index: lowestUnusedIndex(pool.slots.filter((s) => s.index > 0).map((s) => s.index)), reuse: false };
}

export async function repairPool(ctx: Context): Promise<string[]> {
    const pool = await loadPool(ctx);
    const fixed: string[] = [];
    const missing = pool.slots.filter((s) => s.problem === "missing");
    if (missing.length > 0) {
        await runGit(["worktree", "prune"], ctx.root);
        for (const s of missing) {
            await rm(markerPath(ctx.poolRoot, ctx.repoName, s.index), { force: true });
            fixed.push(`slot ${s.index}: pruned the missing worktree`);
        }
    }
    for (const s of pool.slots.filter((x) => x.problem === "orphan-marker")) {
        await rm(markerPath(ctx.poolRoot, ctx.repoName, s.index), { force: true });
        fixed.push(`slot ${s.index}: removed the free marker without a worktree`);
    }
    return fixed;
}
