import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Superset's lifecycle-script convention, as its source resolves it (loadSetupConfig and
// resolveScript in superset-sh/superset, packages/host-service/src/runtime/setup/config.ts).

export type LifecycleKey = "setup" | "teardown";

export type ResolvedScript =
  | { kind: "commands"; commands: string[]; cwd: string }
  | { kind: "script"; scriptPath: string; cwd: string };

export interface Resolution {
  script: ResolvedScript | null;
  warnings: string[];
}

const SCRIPT_KEYS = ["setup", "teardown", "run", "start"] as const;

type BaseConfig = Partial<Record<(typeof SCRIPT_KEYS)[number], string[]>> & { cwd?: string };
type LocalValue = string[] | { before?: string[]; after?: string[] };
type LocalConfig = Partial<Record<(typeof SCRIPT_KEYS)[number], LocalValue>>;

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const configFile = (dir: string, name: string) => path.join(dir, ".superset", name);

// Superset has no Windows rule. Its path.join would put "C:" inside the path, so drop the colon.
export function userOverridePath(home: string, root: string, platform: NodeJS.Platform): string {
    const p = platform === "win32" ? path.win32 : path.posix;
    const parts = root.split(/[\\/]+/).filter(Boolean).map((s) => s.replace(/:$/, ""));
    return p.join(home, ".superset", "projects", ...parts, "config.json");
}

// Missing: null, silently. Unreadable or invalid: null, with a warning. Superset logs the same cases and goes on.
async function readJson(file: string, warnings: string[]): Promise<unknown> {
    if (!existsSync(file)) return null;
    try {
        const text = await readFile(file, "utf8");
        // Notepad saves UTF-8 with a BOM, and JSON.parse rejects it.
        return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    }
    catch (e) {
        warnings.push(`ignored ${file}: ${(e as Error).message}`);
        return null;
    }
}

async function readBase(file: string, warnings: string[]): Promise<BaseConfig | null> {
    const parsed = await readJson(file, warnings);
    if (parsed === null) return null;
    const bad = (why: string) => {
        warnings.push(`ignored ${file}: ${why}`);
        return null;
    };
    if (!isObject(parsed)) return bad("it is not a JSON object");
    const out: BaseConfig = {};
    if (parsed.cwd !== undefined) {
        if (typeof parsed.cwd !== "string" || parsed.cwd.trim() === "") return bad("'cwd' must be a non-empty string");
        out.cwd = parsed.cwd.trim();
    }
    for (const key of SCRIPT_KEYS) {
        const v = parsed[key];
        if (v === undefined) continue;
        if (!isStrings(v)) return bad(`'${key}' must be an array of strings`);
        out[key] = v;
    }
    return out;
}

async function readLocal(file: string, warnings: string[]): Promise<LocalConfig | null> {
    const parsed = await readJson(file, warnings);
    if (parsed === null) return null;
    const bad = (why: string) => {
        warnings.push(`ignored ${file}: ${why}`);
        return null;
    };
    if (!isObject(parsed)) return bad("it is not a JSON object");
    const out: LocalConfig = {};
    for (const key of SCRIPT_KEYS) {
        const v = parsed[key];
        if (v === undefined) continue;
        if (isStrings(v)) {
            out[key] = v;
            continue;
        }
        if (!isObject(v)) return bad(`'${key}' must be an array or {before, after}`);
        if (v.before !== undefined && !isStrings(v.before)) return bad(`'${key}.before' must be an array of strings`);
        if (v.after !== undefined && !isStrings(v.after)) return bad(`'${key}.after' must be an array of strings`);
        out[key] = { before: v.before, after: v.after };
    }
    return out;
}

// Per key, the later config wins when it defines the key. An empty array counts as defined.
function merge(lower: BaseConfig | null, higher: BaseConfig | null): BaseConfig | null {
    if (!lower) return higher;
    if (!higher) return lower;
    const out: BaseConfig = { cwd: higher.cwd ?? lower.cwd };
    for (const key of SCRIPT_KEYS) out[key] = higher[key] ?? lower[key];
    return out;
}

export async function resolveLifecycle(
    key: LifecycleKey,
    at: { root: string; slot: string; home: string; platform: NodeJS.Platform }
): Promise<Resolution> {
    const warnings: string[] = [];
    const repo = await readBase(configFile(at.root, "config.json"), warnings);
    const worktree = await readBase(configFile(at.slot, "config.json"), warnings);
    const user = await readBase(userOverridePath(at.home, at.root, at.platform), warnings);
    const base = merge(merge(repo, worktree), user);

    let list = base?.[key];
    if (base) {
        const local = (await readLocal(configFile(at.slot, "config.local.json"), warnings))
            ?? (await readLocal(configFile(at.root, "config.local.json"), warnings));
        const overlay = local?.[key];
        if (Array.isArray(overlay)) list = overlay;
        else if (overlay) list = [...(overlay.before ?? []), ...(list ?? []), ...(overlay.after ?? [])];
    }

    const cwd = base?.cwd ? path.resolve(at.slot, base.cwd) : at.slot;
    const commands = (list ?? []).filter((c) => c.trim() !== "");
    if (commands.length > 0) return { script: { kind: "commands", commands, cwd }, warnings };

    for (const dir of [at.slot, at.root]) {
        const scriptPath = configFile(dir, `${key}.sh`);
        if (existsSync(scriptPath)) return { script: { kind: "script", scriptPath, cwd }, warnings };
    }
    return { script: null, warnings };
}
