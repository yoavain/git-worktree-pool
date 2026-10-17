import type { WtpConfig } from "./config.js";
import type { Context } from "./context.js";
import { UserError } from "./errors.js";
import { runGit, tryGit } from "./git.js";
import type { Pool } from "./pool.js";

export type BranchPlan =
  | { kind: "local"; name: string }
  | { kind: "remote"; name: string; remote: string }
  | { kind: "new"; name: string; base: string };

export interface ResolvedBranch {
  plan: BranchPlan;
  warning?: string;
}

export interface BranchChoice {
  name: string;
  source: "local" | "remote";
}

const FETCH_TIMEOUT_MS = 60_000;

async function refExists(ref: string, cwd: string): Promise<boolean> {
    return (await tryGit(["show-ref", "--verify", "--quiet", ref], cwd)).ok;
}

export async function validateBranchName(name: string, cwd: string): Promise<void> {
    const r = await tryGit(["check-ref-format", "--branch", name], cwd);
    if (!r.ok || name.startsWith("-")) throw new UserError(`"${name}" is not a valid branch name.`);
}

export async function resolveBranch(ctx: Context, name: string, cfg: WtpConfig): Promise<ResolvedBranch> {
    await validateBranchName(name, ctx.root);
    if (await refExists(`refs/heads/${name}`, ctx.root)) return { plan: { kind: "local", name } };

    let warning: string | undefined;
    if ((await tryGit(["remote", "get-url", cfg.remote], ctx.root)).ok) {
        const fetched = await tryGit(
            ["fetch", "--quiet", cfg.remote, `+refs/heads/${name}:refs/remotes/${cfg.remote}/${name}`],
            ctx.root,
            { timeoutMs: FETCH_TIMEOUT_MS }
        );
        // The remote answered that it has no such branch, so a local refs/remotes/... copy is stale.
        const goneOnRemote = !fetched.ok && /couldn't find remote ref/i.test(fetched.stderr);
        if (!fetched.ok && !goneOnRemote) {
            const reason = fetched.stderr.trim().split("\n")[0] ?? "unknown error";
            warning = `Could not fetch from ${cfg.remote} (${reason}). wtp used the local refs.`;
        }
        if (!goneOnRemote && (await refExists(`refs/remotes/${cfg.remote}/${name}`, ctx.root))) {
            return { plan: { kind: "remote", name, remote: cfg.remote }, warning };
        }
    }

    if (!(await refExists(`refs/heads/${cfg.base}`, ctx.root))) {
        throw new UserError(`The base branch "${cfg.base}" does not exist locally. Set another one with: git config wtp.base <branch>`);
    }
    return { plan: { kind: "new", name, base: cfg.base }, warning };
}

// Branches that a slot (the clone too) or a worktree outside the pool has checked out. The same rule as findCheckout.
export function takenBranches(pool: Pool): Set<string> {
    const taken = new Set<string>();
    for (const s of pool.slots) if (s.branch && (s.state === "active" || s.state === "root")) taken.add(s.branch);
    for (const x of pool.external) if (x.branch) taken.add(x.branch);
    return taken;
}

export function findCheckout(pool: Pool, name: string): { index: number | null; path: string } | null {
    const slot = pool.slots.find((s) => s.branch === name && (s.state === "active" || s.state === "root"));
    if (slot) return { index: slot.index, path: slot.path };
    const ext = pool.external.find((x) => x.branch === name);
    return ext ? { index: null, path: ext.path } : null;
}

export async function listBranches(ctx: Context, cfg: WtpConfig): Promise<BranchChoice[]> {
    const out = await runGit(["for-each-ref", "--format=%(refname)", "refs/heads", `refs/remotes/${cfg.remote}`], ctx.root);
    const local = new Set<string>();
    const remote = new Set<string>();
    const remotePrefix = `refs/remotes/${cfg.remote}/`;
    for (const line of out.split("\n").map((l) => l.trim()).filter(Boolean)) {
        if (line.startsWith("refs/heads/")) local.add(line.slice("refs/heads/".length));
        else if (line.startsWith(remotePrefix)) {
            const name = line.slice(remotePrefix.length);
            if (name !== "HEAD") remote.add(name);
        }
    }
    return [
        ...[...local].sort().map((name) => ({ name, source: "local" as const })),
        ...[...remote].filter((n) => !local.has(n)).sort().map((name) => ({ name, source: "remote" as const }))
    ];
}
