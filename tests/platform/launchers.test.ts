import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    chooseFolder, findLauncher, launcherNames, launcherSourceDir, LAUNCHER_FILES, LAUNCHER_VERSION,
    listMarkedLaunchers, markerVersion, realFs, scanWtp, writeLaunchers, type FsDeps
} from "../../src/platform/launchers.js";
import type { ProcInfo } from "../../src/platform/process-tree.js";

const MARKED = "rem wtp-launcher 1\r\n";

// A fake Windows file system: file -> first bytes, plus the writable folders.
function fakeFs(files: Record<string, string>, writable: string[]): FsDeps {
    const key = (p: string) => p.toLowerCase();
    const map = new Map(Object.entries(files).map(([k, v]) => [key(k), v]));
    return {
        isFile: (p) => map.has(key(p)),
        readHead: (p) => map.get(key(p)) ?? null,
        isWritableDir: (d) => writable.some((w) => key(w) === key(d))
    };
}

const LAD = "C:\\Users\\me\\AppData\\Local";
const WA = `${LAD}\\Microsoft\\WindowsApps`;
const NVM = "C:\\nvm\\.nodejs";
const NPM = "C:\\Users\\me\\AppData\\Roaming\\npm";
const proxy: ProcInfo[] = [
    { pid: 3, ppid: 2, exe: "C:\\Windows\\system32\\cmd.exe" },
    { pid: 2, ppid: 1, exe: `${NVM}\\worktree-pool.exe` }
];

describe("markerVersion", () => {
    it("reads the launcher format number", () => {
        expect(markerVersion("@echo off\r\nrem wtp-launcher 7\r\n")).toBe(7);
        expect(markerVersion("@echo off\r\n")).toBeNull();
    });

    it("matches the shipped launcher files", async () => {
        for (const f of LAUNCHER_FILES) {
            expect(markerVersion(await readFile(path.join(launcherSourceDir(), f), "latin1"))).toBe(LAUNCHER_VERSION);
        }
    });
});

describe("chooseFolder", () => {
    const env = { PATH: `${WA};${NVM};C:\\Windows`, LOCALAPPDATA: LAD };

    it("uses the proxy folder when it is writable", () => {
        const fs = fakeFs({}, [NVM]);
        expect(chooseFolder({ platform: "win32", env, parents: proxy, fs })).toEqual({ kind: "beside", dir: NVM });
    });

    it("trusts the proxy over a worktree-pool found on PATH", () => {
        const fs = fakeFs({ "C:\\other\\worktree-pool.cmd": "" }, [NVM, "C:\\other"]);
        const e = { ...env, PATH: `C:\\other;${env.PATH}` };
        expect(chooseFolder({ platform: "win32", env: e, parents: proxy, fs })).toEqual({ kind: "beside", dir: NVM });
    });

    it("searches PATH when no proxy started node", () => {
        const fs = fakeFs({ [`${NPM}\\worktree-pool.cmd`]: "" }, [NPM]);
        const e = { PATH: `${NPM};C:\\Windows`, LOCALAPPDATA: LAD };
        expect(chooseFolder({ platform: "win32", env: e, parents: [], fs })).toEqual({ kind: "beside", dir: NPM });
    });

    it("falls back to WindowsApps when the proxy folder is locked", () => {
        const fs = fakeFs({}, [WA]);
        expect(chooseFolder({ platform: "win32", env, parents: proxy, fs })).toEqual({ kind: "windowsapps", dir: WA });
    });

    it("offers an admin copy when WindowsApps is not on PATH", () => {
        const fs = fakeFs({}, [WA]);
        const e = { ...env, PATH: `${NVM};C:\\Windows` };
        expect(chooseFolder({ platform: "win32", env: e, parents: proxy, fs })).toEqual({ kind: "admin", dir: NVM });
    });

    it("gives up off Windows when the folder is not writable", () => {
        const fs: FsDeps = { isFile: (p) => p === "/usr/bin/worktree-pool", readHead: () => null, isWritableDir: () => false };
        expect(chooseFolder({ platform: "linux", env: { PATH: "/usr/bin" }, parents: [], fs })).toEqual({ kind: "none", dir: "/usr/bin" });
    });
});

describe("scanWtp", () => {
    it("reports a foreign wtp.exe before the target folder", () => {
        const fs = fakeFs({ [`${NVM}\\wtp.exe`]: "MZ" }, []);
        const scan = scanWtp(WA, { platform: "win32", env: { PATH: `${NVM};${WA}` }, fs });
        expect(scan.conflicts).toEqual([{ file: `${NVM}\\wtp.exe`, where: "before" }]);
    });

    it("reports a foreign wtp that the launcher would hide", () => {
        const fs = fakeFs({ "C:\\tools\\wtp.bat": "@echo other" }, []);
        const scan = scanWtp(WA, { platform: "win32", env: { PATH: `${WA};C:\\tools` }, fs });
        expect(scan.conflicts).toEqual([{ file: "C:\\tools\\wtp.bat", where: "after" }]);
    });

    it("reports a foreign file in the target folder, even off PATH", () => {
        const fs = fakeFs({ [`${WA}\\wtp.ps1`]: "# mine" }, []);
        const scan = scanWtp(WA, { platform: "win32", env: { PATH: "C:\\Windows" }, fs });
        expect(scan.conflicts).toEqual([{ file: `${WA}\\wtp.ps1`, where: "target" }]);
    });

    it("sorts marked launchers into ours and stale", () => {
        const fs = fakeFs({ [`${WA}\\wtp.cmd`]: MARKED, [`${NPM}\\wtp.cmd`]: MARKED }, []);
        const scan = scanWtp(WA, { platform: "win32", env: { PATH: `${NPM};${WA}` }, fs });
        expect(scan).toEqual({ ours: [`${WA}\\wtp.cmd`], stale: [`${NPM}\\wtp.cmd`], conflicts: [] });
    });
});

describe("findLauncher and listMarkedLaunchers", () => {
    it("find marked launchers on PATH and in WindowsApps", () => {
        const fs = fakeFs({ [`${WA}\\wtp.cmd`]: MARKED, [`${WA}\\wtp`]: "# wtp-launcher 1", "C:\\tools\\wtp.cmd": "@echo other" }, []);
        const deps = { platform: "win32" as const, env: { PATH: "C:\\tools", LOCALAPPDATA: LAD }, fs };
        expect(listMarkedLaunchers(deps)).toEqual([`${WA}\\wtp.cmd`, `${WA}\\wtp`]);
        expect(findLauncher(deps)).toBeNull();
        expect(findLauncher({ ...deps, env: { PATH: `C:\\tools;${WA}` } })).toBe(`${WA}\\wtp.cmd`);
    });
});

describe("writeLaunchers and realFs", () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), "wtp-launchers-"));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("copies the files byte for byte and says which ones it replaced", async () => {
        const names = launcherNames(process.platform);
        await writeFile(path.join(dir, names[0]!), "old launcher, wtp-launcher 0");
        const results = await writeLaunchers(dir, names, { platform: process.platform, srcDir: launcherSourceDir() });
        expect(results.map((r) => r.action)).toEqual(names.map((_, i) => (i === 0 ? "replaced" : "wrote")));
        for (const n of names) {
            expect(await readFile(path.join(dir, n))).toEqual(await readFile(path.join(launcherSourceDir(), n)));
        }
    });

    it("detects writability with a probe file and leaves nothing behind", async () => {
        expect(realFs.isWritableDir(dir)).toBe(true);
        expect(await readdir(dir)).toEqual([]);
        expect(realFs.isWritableDir(path.join(dir, "missing"))).toBe(false);
    });

    it("reads the head of a file, or null", async () => {
        await writeFile(path.join(dir, "f"), "abc");
        expect(realFs.readHead(path.join(dir, "f"))).toBe("abc");
        expect(realFs.readHead(path.join(dir, "nope"))).toBeNull();
        expect(existsSync(path.join(dir, "nope"))).toBe(false);
    });

    it("names three launchers on Windows and one elsewhere", () => {
        expect(launcherNames("win32")).toEqual(["wtp.cmd", "wtp.ps1", "wtp"]);
        expect(launcherNames("linux")).toEqual(["wtp"]);
    });
});
