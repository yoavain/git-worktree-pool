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

function key(p: string): string {
    const resolved = path.resolve(p);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function samePath(a: string, b: string): boolean {
    return key(a) === key(b);
}

export function isInside(child: string, parent: string): boolean {
    const rel = path.relative(key(parent), key(child));
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
