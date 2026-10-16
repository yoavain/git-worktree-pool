import { existsSync } from "node:fs";
import path from "node:path";
import { tryGit } from "../core/git.js";

export function gitBashFromExecPath(execPath: string): string[] {
    const gitRoot = path.win32.resolve(execPath, "..", "..", "..");
    return [path.win32.join(gitRoot, "bin", "bash.exe"), path.win32.join(gitRoot, "usr", "bin", "bash.exe")];
}

async function gitExecPath(): Promise<string | null> {
    const r = await tryGit(["--exec-path"], process.cwd());
    return r.ok ? r.stdout.trim() : null;
}

export async function findGitBash(deps: {
  platform?: NodeJS.Platform;
  execPath?: () => Promise<string | null>;
  exists?: (p: string) => boolean;
} = {}): Promise<string | null> {
    const platform = deps.platform ?? process.platform;
    if (platform !== "win32") return "bash";
    const execPath = await (deps.execPath ?? gitExecPath)();
    if (!execPath) return null;
    const exists = deps.exists ?? existsSync;
    return gitBashFromExecPath(execPath).find((p) => exists(p)) ?? null;
}
