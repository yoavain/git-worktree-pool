import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { samePath, slotPath } from "../src/core/naming.js";
import { makeRepo, type Fixture } from "../tests/helpers/repo.js";

const exec = promisify(execFile);
const win = process.platform === "win32";
// fileURLToPath, not import.meta.dirname: that is experimental below Node 22.16, and engines allows 22.12.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
// Only CI runs this. It installs the package for real, and on a developer machine a version manager
// (nvm shim mode) can route node to the developer's own global install.
const enabled = Boolean(process.env.CI);
const npmCli = process.env.npm_execpath;

interface Result { stdout: string; stderr: string; code: number }
async function run(cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd: string }): Promise<Result> {
    try {
        const r = await exec(cmd, args, { ...opts, windowsHide: true });
        return { stdout: r.stdout, stderr: r.stderr, code: 0 };
    }
    catch (e) {
        const x = e as { stdout?: string; stderr?: string; code?: number };
        return { stdout: x.stdout ?? "", stderr: x.stderr ?? "", code: x.code ?? -1 };
    }
}
const lastLine = (s: string) => s.trim().split(/\r?\n/).pop() ?? "";
const npm = (args: string[], cwd: string) => exec(process.execPath, [npmCli!, ...args], { cwd });

let tmp: string;
let prefix: string;
let binDir: string;
let env: NodeJS.ProcessEnv;
let fx: Fixture;
let fxU: Fixture;

async function setup(extra: string[] = [], over: NodeJS.ProcessEnv = {}): Promise<Result> {
    return win
        ? run("cmd.exe", ["/d", "/c", `worktree-pool setup --yes ${extra.join(" ")}`], { env: { ...env, ...over }, cwd: tmp })
        : run(path.join(binDir, "worktree-pool"), ["setup", "--yes", ...extra], { env: { ...env, ...over }, cwd: tmp });
}

beforeAll(async () => {
    if (!enabled) return;
    if (!npmCli) throw new Error("Run this through \"npm run test:e2e\".");
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), "wtp-e2e-")));
    prefix = path.join(tmp, "prefix");
    binDir = win ? prefix : path.join(prefix, "bin");
    const home = path.join(tmp, "home");
    await mkdir(home);
    await npm(["pack", "--pack-destination", tmp], repoRoot);
    const tgz = (await readdir(tmp)).find((f) => f.endsWith(".tgz"))!;
    await npm(["install", "-g", "--prefix", prefix, path.join(tmp, tgz)], tmp);
    const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH"));
    env = { ...base, PATH: [binDir, process.env.PATH].join(path.delimiter), HOME: home, USERPROFILE: home, SHELL: "/bin/bash" };
    fx = await makeRepo();
    await fx.addWorktree(1, "feat");
    fxU = await makeRepo("my-repo", { parentName: "dir ü" });
    await fxU.addWorktree(1, "feat");
    const r = await setup();
    if (r.code !== 0) throw new Error(`setup failed:\n${r.stderr}`);
});

const slot1 = (f: Fixture) => slotPath(f.poolRoot, "my-repo", 1);

describe.runIf(enabled && win)("installed package on Windows", () => {
    const cmd = (line: string, cwd: string) => run("cmd.exe", ["/d", "/v:on", "/c", line], { env, cwd });

    it("setup wrote the three launchers next to worktree-pool", () => {
        for (const n of ["wtp.cmd", "wtp.ps1", "wtp"]) expect(existsSync(path.join(binDir, n))).toBe(true);
    });

    it("wtp switch moves cmd into the slot", async () => {
        expect(samePath(lastLine((await cmd("wtp switch 1 & node -p process.cwd()", fx.root)).stdout), slot1(fx))).toBe(true);
    });

    it("wtp switch moves cmd into a non-ASCII slot path", async () => {
        expect(samePath(lastLine((await cmd("wtp switch 1 & node -p process.cwd()", fxU.root)).stdout), slot1(fxU))).toBe(true);
    });

    it("the exit code reaches cmd", async () => {
        expect(lastLine((await cmd("wtp switch 9 & echo rc=!errorlevel!", fx.root)).stdout)).toBe("rc=1");
    });

    // powershell.exe is Windows PowerShell 5.1. In CI it inherits pwsh's PSModulePath, like a 5.1 started from pwsh.
    for (const exe of ["pwsh", "powershell.exe"]) {
        it(`wtp switch moves ${exe} into the slot`, async () => {
            const command = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; wtp switch 1 *> $null; (Get-Location).Path";
            const r = await run(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { env, cwd: fx.root });
            expect(samePath(lastLine(r.stdout), slot1(fx)), r.stderr).toBe(true);
        });
    }

    it("setup --remove deletes the launchers", async () => {
        expect((await setup(["--remove"])).code).toBe(0);
        expect(existsSync(path.join(binDir, "wtp.cmd"))).toBe(false);
        expect((await setup()).code).toBe(0);
    });

    it("the launcher explains an uninstalled worktree-pool", async () => {
        await npm(["uninstall", "-g", "--prefix", prefix, "git-worktree-pool"], tmp);
        const r = await cmd("wtp list & echo rc=!errorlevel!", fx.root);
        expect(lastLine(r.stdout)).toBe("rc=9009");
        expect(r.stderr).toContain("worktree-pool is not installed");
    });
});

describe.runIf(enabled && !win)("installed package on macOS and Linux", () => {
    const zshOk = existsSync("/bin/zsh") || existsSync("/usr/bin/zsh");

    it("wtp switch moves bash into the slot", async () => {
        const r = await run("bash", ["-i", "-c", "cd \"$1\" && wtp switch 1 >/dev/null 2>&1; pwd", "_", fx.root], { env, cwd: tmp });
        expect(samePath(lastLine(r.stdout), slot1(fx))).toBe(true);
    });

    it("wtp switch moves bash into a non-ASCII slot path", async () => {
        const r = await run("bash", ["-i", "-c", "cd \"$1\" && wtp switch 1 >/dev/null 2>&1; pwd", "_", fxU.root], { env, cwd: tmp });
        expect(samePath(lastLine(r.stdout), slot1(fxU))).toBe(true);
    });

    it.runIf(zshOk)("wtp switch moves zsh into the slot", async () => {
        expect((await setup([], { SHELL: "/bin/zsh" })).code).toBe(0);
        const r = await run("zsh", ["-i", "-c", "cd \"$1\" && wtp switch 1 >/dev/null 2>&1; pwd", "_", fx.root], { env, cwd: tmp });
        expect(samePath(lastLine(r.stdout), slot1(fx))).toBe(true);
    });

    it("the sh launcher runs worktree-pool", async () => {
        const r = await run("sh", ["-c", "wtp --version"], { env, cwd: tmp });
        expect(lastLine(r.stdout)).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("the sh launcher explains an uninstalled worktree-pool", async () => {
        await npm(["uninstall", "-g", "--prefix", prefix, "git-worktree-pool"], tmp);
        const r = await run("sh", ["-c", "wtp list; echo \"rc=$?\""], { env, cwd: tmp });
        expect(lastLine(r.stdout)).toBe("rc=127");
        expect(r.stderr).toContain("worktree-pool is not installed");
    });
});

describe.runIf(!enabled)("install test", () => {
    it("runs only in CI", () => {
        expect(enabled).toBe(false);
    });
});
