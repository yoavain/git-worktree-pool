import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Args } from "../../src/cli/main.js";
import { setupCommand, type SetupDeps } from "../../src/cli/commands/setup.js";
import { launcherNames, launcherSourceDir, realFs } from "../../src/platform/launchers.js";
import { adminCopyArgs } from "../../src/platform/powershell.js";
import { MARKER, profileLine } from "../../src/platform/shell-init.js";
import { makeIo } from "../helpers/io.js";

const win = process.platform === "win32";
const names = launcherNames(process.platform);
const args = (values: Record<string, boolean>): Args => ({ command: "setup", positionals: [], values });

let tmp: string;
let bin: string;
let home: string;

function deps(over: Partial<SetupDeps> = {}): SetupDeps {
    return {
        fs: realFs,
        srcDir: launcherSourceDir(),
        parents: async () => [],
        ps51Policy: async () => null,
        adminCopy: async () => false,
        ...over
    };
}

function io(extraPath: string[] = [], opts: { answer?: boolean; env?: NodeJS.ProcessEnv } = {}) {
    const env: NodeJS.ProcessEnv = { PATH: [...extraPath, bin].join(path.delimiter), SHELL: "/bin/bash", ...opts.env };
    return makeIo(tmp, { env, home, answer: opts.answer ?? true, integration: false });
}

beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "wtp-setup-"));
    bin = path.join(tmp, "bin");
    home = path.join(tmp, "home");
    await mkdir(bin);
    await mkdir(home);
    await writeFile(path.join(bin, win ? "worktree-pool.cmd" : "worktree-pool"), "");
});

afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
});

describe("setup", () => {
    it("writes the launchers next to worktree-pool and says which wtp runs", async () => {
        const t = io();
        expect(await setupCommand(args({ yes: true }), t.io, deps())).toBe(0);
        for (const n of names) expect(existsSync(path.join(bin, n))).toBe(true);
        expect(t.err()).toContain(`wtp runs ${path.join(bin, win ? "wtp.cmd" : "wtp")}`);
        expect(t.err()).not.toContain("✓");
    });

    it("adds the bash function off Windows", async () => {
        if (win) return;
        expect(await setupCommand(args({ yes: true }), io().io, deps())).toBe(0);
        expect(await readFile(path.join(home, ".bashrc"), "utf8")).toContain(profileLine("bash"));
    });

    it("adds the bash function on Windows when Git Bash is in use", async () => {
        if (!win) return;
        const t = io([], { env: { MSYSTEM: "MINGW64" } });
        expect(await setupCommand(args({ yes: true }), t.io, deps())).toBe(0);
        expect(await readFile(path.join(home, ".bashrc"), "utf8")).toContain(profileLine("bash"));
    });

    it("reports up-to-date launchers the second time", async () => {
        await setupCommand(args({ yes: true }), io().io, deps());
        const t = io();
        expect(await setupCommand(args({ yes: true }), t.io, deps())).toBe(0);
        expect(t.err()).toContain("are up to date");
    });

    it("asks first, and changes nothing on no", async () => {
        const t = io([], { answer: false });
        expect(await setupCommand(args({}), t.io, deps())).toBe(1);
        expect(t.questions.length).toBeGreaterThan(0);
        for (const n of names) expect(existsSync(path.join(bin, n))).toBe(false);
    });

    it("takes Enter as yes for its write prompts, but not for --remove", async () => {
        const t = io();
        expect(await setupCommand(args({}), t.io, deps())).toBe(0);
        expect(t.defaults.length).toBeGreaterThan(0);
        expect(t.defaults.every(Boolean)).toBe(true);
        const r = io();
        expect(await setupCommand(args({ remove: true }), r.io, deps())).toBe(0);
        expect(r.defaults).toEqual([false]);
    });

    it("stops when another wtp comes first", async () => {
        const other = path.join(tmp, "other");
        await mkdir(other);
        const foreign = path.join(other, win ? "wtp.exe" : "wtp");
        await writeFile(foreign, "MZ");
        const t = io([other]);
        expect(await setupCommand(args({ yes: true }), t.io, deps())).toBe(1);
        expect(t.err()).toContain(foreign);
        expect(t.err()).toContain("old wtp install");
        for (const n of names) expect(existsSync(path.join(bin, n))).toBe(false);
    });

    it("names an old install also when the foreign wtp comes later on PATH", async () => {
        const other = path.join(tmp, "other");
        await mkdir(other);
        const foreign = path.join(other, win ? "wtp.exe" : "wtp");
        await writeFile(foreign, "MZ");
        const t = io([], { env: { PATH: [bin, other].join(path.delimiter) } });
        expect(await setupCommand(args({ yes: true }), t.io, deps())).toBe(1);
        expect(t.err()).toContain(foreign);
        expect(t.err()).toContain("old wtp install");
    });

    it("stops after a conflict and leaves the profile alone", async () => {
        const other = path.join(tmp, "other");
        await mkdir(other);
        await writeFile(path.join(other, win ? "wtp.exe" : "wtp"), "MZ");
        const t = io([other], { env: { MSYSTEM: "MINGW64" } });
        expect(await setupCommand(args({ yes: true }), t.io, deps())).toBe(1);
        expect(existsSync(path.join(home, ".bashrc"))).toBe(false);
    });

    it("does not trust an admin copy that wrote nothing", async () => {
        if (!win) return;
        const locked = { ...realFs, isWritableDir: () => false };
        const t = io();
        const rc = await setupCommand(args({ yes: true }), t.io, deps({ fs: locked, adminCopy: async () => true }));
        expect(rc).toBe(1);
        expect(t.err()).not.toContain("✓ wrote");
        expect(t.err()).toContain("copy \"");
    });

    it("never overwrites a foreign file in the target folder", async () => {
        const mine = path.join(bin, win ? "wtp.ps1" : "wtp");
        await writeFile(mine, "my own script");
        expect(await setupCommand(args({ yes: true }), io().io, deps())).toBe(1);
        expect(await readFile(mine, "utf8")).toBe("my own script");
    });

    it("replaces an old launcher and removes one from another folder", async () => {
        const old = path.join(tmp, "old");
        await mkdir(old);
        const stale = path.join(old, win ? "wtp.cmd" : "wtp");
        await writeFile(stale, "rem wtp-launcher 1\n");
        await writeFile(path.join(bin, names[0]!), "rem wtp-launcher 0\n");
        const t = io([], { env: { PATH: [bin, old].join(path.delimiter) } });
        expect(await setupCommand(args({ yes: true }), t.io, deps())).toBe(0);
        expect(existsSync(stale)).toBe(false);
        expect(t.err()).toContain(`replaced ${path.join(bin, names[0]!)}`);
    });

    it("prints manual steps when no folder can be written", async () => {
        const locked = { ...realFs, isWritableDir: () => false };
        const t = io();
        const rc = await setupCommand(args({ yes: true }), t.io, deps({ fs: locked }));
        if (win) {
            expect(rc).toBe(1);
            expect(t.err()).toContain("copy \"");
            expect(t.err()).toContain(launcherSourceDir().replace(/[\\/]+$/, ""));
        }
        else {
            expect(rc).toBe(0);
            expect(t.err()).toContain("Skipped the wtp launcher");
        }
    });

    it("prints the PowerShell 5.1 note when scripts are blocked", async () => {
        if (!win) return;
        const t = io();
        await setupCommand(args({ yes: true }), t.io, deps({ ps51Policy: async () => "Restricted" }));
        expect(t.err()).toContain("Set-ExecutionPolicy -Scope CurrentUser RemoteSigned");
    });

    it("removes what it wrote and nothing else", async () => {
        await setupCommand(args({ yes: true }), io([], { env: { MSYSTEM: "MINGW64" } }).io, deps());
        const other = path.join(tmp, "other");
        await mkdir(other);
        const foreign = path.join(other, win ? "wtp.bat" : "wtp");
        await writeFile(foreign, "echo other");
        const t = io([other], { env: { MSYSTEM: "MINGW64" } });
        expect(await setupCommand(args({ yes: true, remove: true }), t.io, deps())).toBe(0);
        for (const n of names) expect(existsSync(path.join(bin, n))).toBe(false);
        expect(existsSync(foreign)).toBe(true);
        expect(await readFile(path.join(home, ".bashrc"), "utf8")).not.toContain(MARKER);
    });

    it("says so when there is nothing to remove", async () => {
        const t = io();
        expect(await setupCommand(args({ yes: true, remove: true }), t.io, deps())).toBe(0);
        expect(t.err()).toContain("Nothing to remove.");
    });
});

describe("adminCopyArgs", () => {
    it("copies every file in one elevated cmd", () => {
        const a = adminCopyArgs(["C:\\src\\wtp.cmd", "C:\\it's\\wtp.ps1"], "C:\\nvm\\.nodejs");
        const command = a.at(-1)!;
        expect(command).toContain("-Verb RunAs");
        expect(command).toContain("copy /y \"C:\\src\\wtp.cmd\" \"C:\\nvm\\.nodejs\"");
        expect(command).toContain("it''s");
    });
});
