import path from "node:path";

export const POOL_SUFFIX = "-wt-pool";

export function poolRootFor(root: string): string {
    return path.join(path.dirname(root), path.basename(root) + POOL_SUFFIX);
}

export function slotDirName(repoName: string, index: number): string {
    return `${repoName}-wt-${index}`;
}

export function slotPath(poolRoot: string, repoName: string, index: number): string {
    return path.join(poolRoot, slotDirName(repoName, index));
}

export function markerPath(poolRoot: string, repoName: string, index: number): string {
    return path.join(poolRoot, "." + slotDirName(repoName, index));
}

export function parseSlotIndex(repoName: string, dirName: string): number | null {
    const prefix = `${repoName}-wt-`;
    if (!dirName.startsWith(prefix)) return null;
    const rest = dirName.slice(prefix.length);
    return /^[1-9]\d*$/.test(rest) ? Number(rest) : null;
}

export function parseMarkerIndex(repoName: string, fileName: string): number | null {
    return fileName.startsWith(".") ? parseSlotIndex(repoName, fileName.slice(1)) : null;
}

export function lowestUnusedIndex(used: Iterable<number>): number {
    const taken = new Set(used);
    let n = 1;
    while (taken.has(n)) n++;
    return n;
}

export function normalizePath(p: string): string {
    return path.resolve(p);
}

// Windows file names ignore case. Core passes ctx.platform; the default is the machine wtp runs on.
function key(p: string, platform: NodeJS.Platform): string {
    const resolved = path.resolve(p);
    return platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
    return key(a, platform) === key(b, platform);
}

export function isInside(child: string, parent: string, platform: NodeJS.Platform = process.platform): boolean {
    const rel = path.relative(key(parent, platform), key(child, platform));
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
