import type { BranchPlan } from "../core/branch.js";
import { PLAIN_GLYPHS, type Glyphs } from "./glyphs.js";

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

export function slotKind(reused: boolean): string {
    return reused ? "free, reused" : "new";
}

export function freedText(index: number): string {
    return `Slot ${index} is free.`;
}

export function deletedText(index: number, deletedBranch: string | null): string {
    return `Slot ${index} is deleted.${deletedBranch ? ` The branch ${deletedBranch} is deleted too.` : ""}`;
}

// Where the next assign goes, as chooseSlot reports it.
export function slotTarget(next: { index: number; reuse: boolean }): string {
    return `slot ${next.index} (${slotKind(next.reuse)})`;
}

export function assignSummary(
    name: string,
    r: { plan: BranchPlan; index: number; reused: boolean },
    g: Glyphs = PLAIN_GLYPHS
): string {
    return `branch ${name} (${planLabel(r.plan)}) ${g.arrow} slot ${r.index} (${slotKind(r.reused)})`;
}
