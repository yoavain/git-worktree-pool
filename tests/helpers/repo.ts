import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGit } from "../../src/core/git.js";
import { markerPath, slotPath } from "../../src/core/naming.js";

export interface Fixture {
  tmp: string;
  parent: string;
  root: string;
  origin: string;
  poolRoot: string;
  git(cwd: string, ...args: string[]): Promise<string>;
  commitFile(cwd: string, name: string, content: string): Promise<void>;
  addWorktree(index: number, branch: string): Promise<string>;
  markFree(index: number): Promise<void>;
  pushRemoteOnlyBranch(name: string): Promise<void>;
  cleanup(): Promise<void>;
}

export async function makeRepo(name = "my-repo", opts: { parentName?: string } = {}): Promise<Fixture> {
    const tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), "wtp-")));
    const parent = opts.parentName ? path.join(tmp, opts.parentName) : tmp;
    await mkdir(parent, { recursive: true });
    const origin = path.join(tmp, "origin.git");
    const root = path.join(parent, name);
    const poolRoot = path.join(parent, `${name}-wt-pool`);
    const git = (cwd: string, ...args: string[]) => runGit(args, cwd);

    await runGit(["init", "--bare", "-b", "main", origin], tmp);
    await runGit(["init", "-b", "main", root], tmp);
    await git(root, "config", "user.email", "test@example.com");
    await git(root, "config", "user.name", "wtp test");
    await git(root, "config", "commit.gpgsign", "false");
    await writeFile(path.join(root, "README.md"), "hello\n");
    await writeFile(path.join(root, ".gitignore"), "ignored.txt\n");
    await git(root, "add", "README.md", ".gitignore");
    await git(root, "commit", "-m", "init");
    await git(root, "remote", "add", "origin", origin);
    await git(root, "push", "-u", "origin", "main");

    return {
        tmp, parent, root, origin, poolRoot, git,
        async commitFile(cwd, file, content) {
            await writeFile(path.join(cwd, file), content);
            await git(cwd, "add", file);
            await git(cwd, "commit", "-m", `edit ${file}`);
        },
        async addWorktree(index, branch) {
            const dir = slotPath(poolRoot, name, index);
            await mkdir(poolRoot, { recursive: true });
            await git(root, "worktree", "add", "-b", branch, dir, "main");
            return dir;
        },
        async markFree(index) {
            await git(slotPath(poolRoot, name, index), "switch", "--detach");
            await writeFile(markerPath(poolRoot, name, index), "");
        },
        async pushRemoteOnlyBranch(branch) {
            await git(root, "push", "origin", `main:refs/heads/${branch}`);
        },
        async cleanup() {
            await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
    };
}
