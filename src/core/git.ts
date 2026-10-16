import { execFile } from "node:child_process";
import { GitError } from "./errors.js";

export interface GitResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface GitOptions {
  timeoutMs?: number;
}

export function tryGit(args: string[], cwd: string, opts: GitOptions = {}): Promise<GitResult> {
    return new Promise((resolve) => {
        execFile(
            "git",
            args,
            {
                cwd,
                encoding: "utf8",
                maxBuffer: 64 * 1024 * 1024,
                windowsHide: true,
                timeout: opts.timeoutMs ?? 0,
                env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" }
            },
            (err, stdout, stderr) => {
                if (!err) {
                    resolve({ ok: true, code: 0, stdout, stderr });
                    return;
                }
                const raw = (err as { code?: unknown }).code;
                const code = typeof raw === "number" ? raw : null;
                resolve({ ok: false, code, stdout: stdout ?? "", stderr: stderr || err.message });
            }
        );
    });
}

export async function runGit(args: string[], cwd: string, opts: GitOptions = {}): Promise<string> {
    const r = await tryGit(args, cwd, opts);
    if (!r.ok) throw new GitError(args, r.code, r.stderr);
    return r.stdout;
}
