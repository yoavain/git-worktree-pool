import { execFile, spawn, type ChildProcess } from "node:child_process";
import type { SpawnSpec } from "./script-shell.js";

export interface ScriptRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  // inherit: the script owns the terminal (plain CLI). capture: output is kept for an error panel (TUI).
  output: "inherit" | "capture";
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ScriptOutcome {
  code: number | null;
  timedOut: boolean;
  interrupted: boolean;
  tail: string;
}

// The same tail size Superset keeps for a failed teardown.
export const TAIL_CHARS = 4096;
// After the shell exits, how long to wait for the rest of its output. A background process it
// started (start /b, cmd &) can hold the pipes open for good.
const DRAIN_MS = 200;
// How a shell ends when Ctrl+C reached it: 128 + SIGINT on POSIX, STATUS_CONTROL_C_EXIT on Windows.
const CTRL_C_CODES = new Set([130, 0xc000013a]);

// npm and docker start children of their own, so stopping only the shell would leave them running.
function killTree(child: ChildProcess, ownGroup: boolean): void {
    if (child.pid === undefined) return;
    // The group can outlive its leader, so a group kill still makes sense after the shell exited.
    if (child.exitCode !== null && !ownGroup) return;
    if (process.platform === "win32") {
        execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
        return;
    }
    try {
        if (ownGroup) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
    }
    catch {
        // Already gone.
    }
}

export function runSpawn(spec: SpawnSpec, opts: ScriptRunOptions): Promise<ScriptOutcome> {
    return new Promise((resolve) => {
        const capture = opts.output === "capture";
        // A captured script gets its own process group on POSIX, so a kill reaches its children.
        // An inherited one stays in the terminal's group, so Ctrl+C reaches it directly.
        const ownGroup = capture && process.platform !== "win32";
        let tail = "";
        let timedOut = false;
        let interrupted = false;
        let settled = false;
        const add = (s: string) => {
            tail = (tail + s).slice(-TAIL_CHARS);
        };

        let child: ChildProcess;
        try {
            child = spawn(spec.file, spec.args, {
                cwd: opts.cwd,
                env: opts.env,
                windowsHide: true,
                windowsVerbatimArguments: spec.verbatim,
                detached: ownGroup,
                stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
            });
        }
        catch (e) {
            resolve({ code: null, timedOut: false, interrupted: false, tail: (e as Error).message });
            return;
        }

        const onAbort = () => {
            interrupted = true;
            killTree(child, ownGroup);
        };
        const timer = opts.timeoutMs === undefined ? null : setTimeout(() => {
            timedOut = true;
            add(`\n[timed out after ${Math.round(opts.timeoutMs! / 1000)} s]\n`);
            killTree(child, ownGroup);
        }, opts.timeoutMs);
        const finish = (code: number | null, signal: NodeJS.Signals | null = null) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            opts.signal?.removeEventListener("abort", onAbort);
            // wtp's own SIGINT handler can lose the race with the shell's exit. Count the exit code too.
            if (signal === "SIGINT" || (code !== null && CTRL_C_CODES.has(code))) interrupted = true;
            resolve({ code, timedOut, interrupted, tail });
        };

        if (opts.signal?.aborted) onAbort();
        else opts.signal?.addEventListener("abort", onAbort, { once: true });
        for (const stream of [child.stdout, child.stderr]) {
            stream?.setEncoding("utf8");
            stream?.on("data", add);
        }
        child.on("error", (e) => {
            add(e.message);
            finish(null);
        });
        child.on("close", (code, signal) => finish(code, signal));
        child.on("exit", (code, signal) => {
            setTimeout(() => {
                child.stdout?.destroy();
                child.stderr?.destroy();
                finish(code, signal);
            }, DRAIN_MS).unref();
        });
    });
}
