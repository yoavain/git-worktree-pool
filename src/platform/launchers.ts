import { closeSync, existsSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { chmod, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findAllOnPath, findOnPath, isFile, pathApi, pathDirs, pushUniquePath, sameDir, type SearchDeps } from "./path-search.js";
import type { ProcInfo } from "./process-tree.js";

export const LAUNCHER_VERSION = 2;
export const LAUNCHER_FILES = ["wtp.cmd", "wtp.ps1", "wtp"] as const;
// Every file name that a shell on Windows could run as "wtp".
export const WTP_EXTS_WIN = [".exe", ".com", ".bat", ".cmd", ".ps1", ""];
const MARKER_RE = /wtp-launcher (\d+)/;
const HEAD_BYTES = 400;

export function launcherNames(platform: NodeJS.Platform): readonly string[] {
    return platform === "win32" ? LAUNCHER_FILES : ["wtp"];
}

export function launcherSourceDir(): string {
    // dist/platform/launchers.js and src/platform/launchers.ts both sit two levels below the package root.
    return fileURLToPath(new URL("../../launchers/", import.meta.url));
}

export function markerVersion(text: string): number | null {
    const m = MARKER_RE.exec(text.slice(0, HEAD_BYTES));
    return m ? Number(m[1]) : null;
}

export interface FsDeps {
  isFile(p: string): boolean;
  isWritableDir(dir: string): boolean;
  readHead(p: string): string | null;
}

export const realFs: FsDeps = {
    isFile,
    // fs.access(W_OK) only checks the read-only attribute on Windows, not the folder's ACL. Write a probe file instead.
    isWritableDir(dir) {
        const probe = path.join(dir, `.wtp-write-probe-${process.pid}`);
        try {
            writeFileSync(probe, "");
            rmSync(probe, { force: true });
            return true;
        }
        catch {
            return false;
        }
    },
    readHead(p) {
        try {
            const fd = openSync(p, "r");
            try {
                const buf = Buffer.alloc(HEAD_BYTES);
                const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
                return buf.subarray(0, n).toString("latin1");
            }
            finally {
                closeSync(fd);
            }
        }
        catch {
            return null;
        }
    }
};

export type FolderChoice =
  | { kind: "beside" | "windowsapps" | "admin"; dir: string }
  | { kind: "none"; dir: string | null };

type FolderDeps = SearchDeps & { parents: ProcInfo[]; fs: FsDeps };

// The folder of the worktree-pool that the user's shell runs. A proxy .exe in node's parent chain
// (nvm shim mode, Volta, scoop) is that folder. Without a proxy, node's PATH is the shell's PATH.
export function binFolder(deps: FolderDeps): string | null {
    const p = pathApi(deps.platform);
    const proxy = deps.parents.find((x) => p.basename(x.exe).toLowerCase() === "worktree-pool.exe");
    if (proxy) return p.dirname(proxy.exe);
    const found = findOnPath("worktree-pool", { ...deps, isFile: deps.fs.isFile });
    return found ? p.dirname(found) : null;
}

export function windowsAppsDir(env: NodeJS.ProcessEnv): string | null {
    return env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps") : null;
}

export function chooseFolder(deps: FolderDeps): FolderChoice {
    const bin = binFolder(deps);
    if (bin && deps.fs.isWritableDir(bin)) return { kind: "beside", dir: bin };
    if (deps.platform === "win32") {
        const wa = windowsAppsDir(deps.env);
        if (wa && pathDirs(deps).some((d) => sameDir(d, wa, "win32")) && deps.fs.isWritableDir(wa)) {
            return { kind: "windowsapps", dir: wa };
        }
        if (bin) return { kind: "admin", dir: bin };
    }
    return { kind: "none", dir: bin };
}

export interface Conflict {
  file: string;
  where: "before" | "after" | "target";
}

export interface Scan {
  ours: string[];
  stale: string[];
  conflicts: Conflict[];
}

// The format number in a launcher file, or null when the file is missing or is not a wtp launcher.
export function launcherVersion(file: string, fs: FsDeps): number | null {
    const head = fs.readHead(file);
    return head === null ? null : markerVersion(head);
}

export function isMarked(file: string, fs: FsDeps): boolean {
    return launcherVersion(file, fs) !== null;
}

export function isCurrentLauncher(file: string, fs: FsDeps): boolean {
    return (launcherVersion(file, fs) ?? -1) >= LAUNCHER_VERSION;
}

function wtpFiles(deps: SearchDeps & { fs: FsDeps }): string[] {
    const exts = deps.platform === "win32" ? WTP_EXTS_WIN : [""];
    return findAllOnPath("wtp", { ...deps, exts, isFile: deps.fs.isFile });
}

export function scanWtp(target: string, deps: SearchDeps & { fs: FsDeps }): Scan {
    const p = pathApi(deps.platform);
    const dirs = pathDirs(deps);
    const indexOf = (dir: string) => dirs.findIndex((d) => sameDir(d, dir, deps.platform));
    const targetIndex = indexOf(target);
    const files = wtpFiles(deps);
    for (const name of LAUNCHER_FILES) {
        const file = p.join(target, name);
        if (deps.fs.isFile(file)) pushUniquePath(files, file);
    }
    const scan: Scan = { ours: [], stale: [], conflicts: [] };
    for (const file of files) {
        const inTarget = sameDir(p.dirname(file), target, deps.platform);
        if (isMarked(file, deps.fs)) {
            (inTarget ? scan.ours : scan.stale).push(file);
        }
        else if (inTarget) {
            scan.conflicts.push({ file, where: "target" });
        }
        else {
            const before = targetIndex === -1 || indexOf(p.dirname(file)) < targetIndex;
            scan.conflicts.push({ file, where: before ? "before" : "after" });
        }
    }
    return scan;
}

export async function writeLaunchers(
    target: string,
    names: readonly string[],
    opts: { platform: NodeJS.Platform; srcDir: string }
): Promise<{ file: string; action: "wrote" | "replaced" }[]> {
    const results: { file: string; action: "wrote" | "replaced" }[] = [];
    for (const name of names) {
        const file = path.join(target, name);
        const existed = existsSync(file);
        await copyFile(path.join(opts.srcDir, name), file);
        if (name === "wtp" && opts.platform !== "win32") await chmod(file, 0o755);
        results.push({ file, action: existed ? "replaced" : "wrote" });
    }
    return results;
}

export function listMarkedLaunchers(deps: SearchDeps & { fs: FsDeps }): string[] {
    const p = pathApi(deps.platform);
    const dirs = pathDirs(deps);
    const wa = deps.platform === "win32" ? windowsAppsDir(deps.env) : null;
    if (wa) dirs.push(wa);
    const found: string[] = [];
    for (const dir of dirs) {
        for (const name of LAUNCHER_FILES) {
            const file = p.join(dir, name);
            if (deps.fs.isFile(file) && isMarked(file, deps.fs)) pushUniquePath(found, file);
        }
    }
    return found;
}

export function findLauncher(deps: SearchDeps & { fs: FsDeps }): string | null {
    return wtpFiles(deps).find((f) => isMarked(f, deps.fs)) ?? null;
}
