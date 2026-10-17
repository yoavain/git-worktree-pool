import type { Context } from "./context.js";
import { tryGit } from "./git.js";
import { loadPool, problemLabel } from "./pool.js";

export const MIN_GIT: [number, number, number] = [2, 31, 0];

export interface Diagnosis {
  gitVersion: string | null;
  gitTooOld: boolean;
  problems: { index: number; path: string; problem: string; autoFix: boolean }[];
}

export function parseGitVersion(out: string): [number, number, number] | null {
    const m = /git version (\d+)\.(\d+)\.(\d+)/.exec(out);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function older(a: [number, number, number], b: [number, number, number]): boolean {
    for (let i = 0; i < 3; i++) {
        if (a[i]! !== b[i]!) return a[i]! < b[i]!;
    }
    return false;
}

export async function diagnose(ctx: Context): Promise<Diagnosis> {
    const v = await tryGit(["--version"], ctx.root);
    const parsed = v.ok ? parseGitVersion(v.stdout) : null;
    const pool = await loadPool(ctx);
    return {
        gitVersion: parsed ? parsed.join(".") : null,
        gitTooOld: parsed ? older(parsed, MIN_GIT) : false,
        problems: pool.slots
            .filter((s) => s.state === "broken")
            .map((s) => ({
                index: s.index,
                path: s.path,
                problem: problemLabel(s.problem),
                autoFix: s.problem === "missing" || s.problem === "orphan-marker"
            }))
    };
}
