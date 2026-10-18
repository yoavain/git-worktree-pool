import { existsSync } from "node:fs";
import { UserError } from "../core/errors.js";
import { resolveLifecycle, type LifecycleKey } from "../core/lifecycle.js";
import { findGitBash } from "../platform/git-bash.js";
import { runSpawn } from "../platform/script-run.js";
import { composeSpawn, pickShell } from "../platform/script-shell.js";
import type { Io } from "./io.js";

// Runs a slot's Superset setup or teardown: resolve the config, pick the calling shell, run the line.

export const SCRIPT_FAILED_EXIT = 4;
// Superset's TEARDOWN_TIMEOUT_MS. Setup has no timeout, as in Superset.
export const TEARDOWN_TIMEOUT_MS = 60_000;

export interface LifecycleTarget {
  root: string;
  index: number;
  path: string;
  branch: string | null;
}

export interface LifecycleDeps {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  output: "inherit" | "capture";
  signal?: AbortSignal;
  onStart?(display: string): void;
  warn(text: string): void;
}

export type LifecycleFailure = {
  status: "failed";
  display: string;
  code: number | null;
  timedOut: boolean;
  interrupted: boolean;
  tail: string;
};

export type LifecycleResult = { status: "skipped" } | { status: "ok"; display: string } | LifecycleFailure;

export async function runLifecycle(key: LifecycleKey, target: LifecycleTarget, deps: LifecycleDeps): Promise<LifecycleResult> {
    const { script, warnings } = await resolveLifecycle(key, { root: target.root, slot: target.path, home: deps.home, platform: deps.platform });
    for (const w of warnings) deps.warn(w);
    if (!script) return { status: "skipped" };

    const picked = pickShell(deps.env, deps.platform);
    if (picked.warning) deps.warn(picked.warning);
    const win = deps.platform === "win32";
    // On Windows, "bash" on PATH can be WSL's launcher, so use the bash that ships with Git.
    const bashExe = win ? await findGitBash({ platform: deps.platform }) : "bash";
    const shell = win && picked.shell.exe === "bash" && bashExe ? { ...picked.shell, exe: bashExe } : picked.shell;
    const spec = composeSpawn(script, shell, bashExe);
    if (!spec) {
        deps.warn(`skipped ${script.kind === "script" ? script.scriptPath : key}: Git Bash was not found`);
        return { status: "skipped" };
    }

    const env: NodeJS.ProcessEnv = {
        ...deps.env,
        SUPERSET_ROOT_PATH: target.root,
        SUPERSET_WORKSPACE_NAME: target.branch ?? "",
        SUPERSET_WORKSPACE_PATH: target.path,
        WTP_SLOT: String(target.index)
    };
    // A script that runs wtp must not write this process's folder handoff file.
    delete env.WTP_CWD_FILE;

    deps.onStart?.(spec.display);
    // Node reports a missing cwd as "spawn cmd.exe ENOENT", which reads as a missing shell.
    if (!existsSync(script.cwd)) {
        return { status: "failed", display: spec.display, code: null, timedOut: false, interrupted: false, tail: `cwd ${script.cwd} does not exist` };
    }
    const r = await runSpawn(spec, {
        cwd: script.cwd,
        env,
        output: deps.output,
        signal: deps.signal,
        timeoutMs: key === "teardown" ? TEARDOWN_TIMEOUT_MS : undefined
    });
    if (r.code === 0 && !r.timedOut && !r.interrupted) return { status: "ok", display: spec.display };
    return { status: "failed", display: spec.display, ...r };
}

export function failureText(key: LifecycleKey, f: LifecycleFailure): string {
    if (f.timedOut) return `${key} timed out after ${TEARDOWN_TIMEOUT_MS / 1000} s`;
    if (f.interrupted) return `${key} was interrupted`;
    return f.code === null ? `${key} failed` : `${key} failed with exit code ${f.code}`;
}

// While a script runs, Ctrl+C reaches it through the console. wtp must outlive it to finish the
// command (hand off the folder, or abort a free), so SIGINT aborts the script instead of ending wtp.
export async function withSigint<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ac = new AbortController();
    const onSigint = () => ac.abort();
    process.on("SIGINT", onSigint);
    try {
        return await job(ac.signal);
    }
    finally {
        process.off("SIGINT", onSigint);
    }
}

// The plain CLI's failure line. A script that never started has its reason only in the tail,
// because the CLI streams the output and keeps no tail of its own.
export function cliFailure(key: LifecycleKey, f: LifecycleFailure, io: Pick<Io, "stderr">): void {
    io.stderr.write(`! ${failureText(key, f)}\n`);
    if (f.code === null && !f.timedOut && !f.interrupted && f.tail) io.stderr.write(`! ${f.tail.trim()}\n`);
}

// The plain CLI's teardown before free or delete. A failure only warns, as in Superset's CLI.
// "interrupted": Ctrl+C stopped it, and the command must change nothing else.
export async function cliTeardown(
    root: string,
    slot: { index: number; path: string; branch: string | null },
    io: Io
): Promise<"ran" | "skipped" | "interrupted"> {
    const r = await withSigint((signal) => runLifecycle("teardown", { root, ...slot }, {
        env: io.env,
        platform: io.platform,
        home: io.home,
        output: "inherit",
        signal,
        onStart: (display) => io.stderr.write(`teardown: ${display}\n`),
        warn: (w) => io.stderr.write(`! ${w}\n`)
    }));
    if (r.status === "skipped") return "skipped";
    if (r.status === "ok") return "ran";
    if (r.interrupted) return "interrupted";
    cliFailure("teardown", r, io);
    return "ran";
}

// A refusal after teardown leaves the slot active but torn down. Say so.
export async function afterTeardown<T>(ran: boolean, job: () => Promise<T>): Promise<T> {
    try {
        return await job();
    }
    catch (e) {
        if (ran && e instanceof UserError && !/teardown/.test(e.message)) throw new UserError(`${e.message} Its teardown already ran.`);
        throw e;
    }
}
