import path from "node:path";
import { ContextError } from "./errors.js";
import { tryGit } from "./git.js";
import { normalizePath, POOL_SUFFIX, poolRootFor, samePath } from "./naming.js";

export interface Context {
  cwd: string;
  root: string;
  repoName: string;
  poolRoot: string;
  // Decides whether paths compare without case (win32), and whether delete probes for file locks.
  platform: NodeJS.Platform;
}

async function commonDirOf(dir: string): Promise<string | null> {
    const r = await tryGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], dir);
    return r.ok ? normalizePath(r.stdout.trim()) : null;
}

function rootFromCommonDir(commonDir: string): string {
    if (path.basename(commonDir) !== ".git") {
        throw new ContextError(`Bare repositories are not supported: ${commonDir}`);
    }
    return path.dirname(commonDir);
}

function makeContext(cwd: string, root: string, platform: NodeJS.Platform): Context {
    return { cwd, root, repoName: path.basename(root), poolRoot: poolRootFor(root), platform };
}

export async function resolveContext(cwd: string, platform: NodeJS.Platform = process.platform): Promise<Context> {
    const start = normalizePath(cwd);

    const commonDir = await commonDirOf(start);
    if (commonDir) return makeContext(start, rootFromCommonDir(commonDir), platform);

    for (let dir = start; ; dir = path.dirname(dir)) {
        const base = path.basename(dir);
        if (base.endsWith(POOL_SUFFIX) && base.length > POOL_SUFFIX.length) {
            const root = path.join(path.dirname(dir), base.slice(0, -POOL_SUFFIX.length));
            const rootCommon = await commonDirOf(root);
            // Use git's answer, not the typed folder name: it has the real letter case on Windows.
            if (rootCommon && samePath(rootFromCommonDir(rootCommon), root, platform)) return makeContext(start, rootFromCommonDir(rootCommon), platform);
            throw new ContextError(`Found the pool ${dir}, but ${root} is not a git clone.`);
        }
        if (path.dirname(dir) === dir) break;
    }
    throw new ContextError("Not inside a git repository or a worktree pool.");
}
