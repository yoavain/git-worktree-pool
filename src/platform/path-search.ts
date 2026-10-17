import { statSync } from "node:fs";
import path from "node:path";

export interface SearchDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  isFile?: (p: string) => boolean;
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export function isFile(p: string): boolean {
    try {
        return statSync(p).isFile();
    }
    catch {
        return false;
    }
}

export function pathApi(platform: NodeJS.Platform): path.PlatformPath {
    return platform === "win32" ? path.win32 : path.posix;
}

// Adds file to list unless the list has it already in another letter case. Windows paths ignore case.
export function pushUniquePath(list: string[], file: string): void {
    if (!list.some((f) => f.toLowerCase() === file.toLowerCase())) list.push(file);
}

export function pathDirs(deps: SearchDeps): string[] {
    const raw = deps.env.PATH ?? deps.env.Path ?? "";
    const sep = deps.platform === "win32" ? ";" : ":";
    return raw
        .split(sep)
        .map((d) => d.trim().replace(/^"(.*)"$/, "$1"))
        .filter(Boolean);
}

export function pathExts(deps: SearchDeps): string[] {
    if (deps.platform !== "win32") return [""];
    return (deps.env.PATHEXT ?? DEFAULT_PATHEXT)
        .split(";")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
}

// The same order as cmd: each PATH folder in turn, and inside it each extension in turn.
export function findAllOnPath(name: string, deps: SearchDeps & { exts?: string[] }): string[] {
    const p = pathApi(deps.platform);
    const exists = deps.isFile ?? isFile;
    const exts = deps.exts ?? pathExts(deps);
    const hits: string[] = [];
    for (const dir of pathDirs(deps)) {
        for (const ext of exts) {
            const file = p.join(dir, name + ext);
            if (exists(file)) pushUniquePath(hits, file);
        }
    }
    return hits;
}

export function findOnPath(name: string, deps: SearchDeps): string | null {
    return findAllOnPath(name, deps)[0] ?? null;
}

export function sameDir(a: string, b: string, platform: NodeJS.Platform): boolean {
    if (platform !== "win32") return path.posix.resolve(a) === path.posix.resolve(b);
    const norm = (d: string) => path.win32.resolve(d).replace(/\\+$/, "").toLowerCase();
    return norm(a) === norm(b);
}
