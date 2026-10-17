import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cdHint, FUNCTION_HINT, SETUP_HINT, USE_WTP_HINT } from "../../src/cli/move.js";
import type { FsDeps } from "../../src/platform/launchers.js";
import { MARKER, profileLine } from "../../src/platform/shell-init.js";

const fs = (files: Record<string, string>): FsDeps => ({
    isFile: (p) => p in files,
    readHead: (p) => files[p] ?? null,
    isWritableDir: () => true
});

const emptyHome = () => mkdtempSync(path.join(os.tmpdir(), "wtp-home-"));
const homeWithBashrc = () => {
    const home = emptyHome();
    writeFileSync(path.join(home, ".bashrc"), `${MARKER}\n${profileLine("bash")}\n`);
    return home;
};

describe("cdHint", () => {
    it("names setup when nothing is set up", async () => {
        expect(await cdHint({ platform: "win32", env: { PATH: "C:\\bin" }, home: emptyHome() }, fs({}))).toBe(SETUP_HINT);
        expect(SETUP_HINT).toContain("worktree-pool setup");
    });

    it("says to use wtp when a launcher exists on Windows", async () => {
        const f = fs({ "C:\\bin\\wtp.cmd": "rem wtp-launcher 3" });
        expect(await cdHint({ platform: "win32", env: { PATH: "C:\\bin" }, home: emptyHome() }, f)).toBe(USE_WTP_HINT);
    });

    it("ignores a wtp that is not a launcher", async () => {
        const f = fs({ "C:\\bin\\wtp.cmd": "@echo other" });
        expect(await cdHint({ platform: "win32", env: { PATH: "C:\\bin" }, home: emptyHome() }, f)).toBe(SETUP_HINT);
    });

    it("asks for the function when the sh launcher ran", async () => {
        const f = fs({ "C:\\bin\\wtp.cmd": "rem wtp-launcher 3" });
        expect(await cdHint({ platform: "win32", env: { PATH: "C:\\bin", WTP_VIA: "sh" }, home: emptyHome() }, f)).toBe(FUNCTION_HINT);
        expect(FUNCTION_HINT).toContain("worktree-pool setup");
    });

    it("says to use wtp off Windows when the profile has the wtp function", async () => {
        const env = { PATH: "/usr/bin", SHELL: "/bin/bash" };
        expect(await cdHint({ platform: "linux", env, home: homeWithBashrc() }, fs({}))).toBe(USE_WTP_HINT);
    });

    it("says to use wtp in Git Bash when .bashrc has the wtp function", async () => {
        const env = { PATH: "C:\\bin", MSYSTEM: "MINGW64" };
        expect(await cdHint({ platform: "win32", env, home: homeWithBashrc() }, fs({}))).toBe(USE_WTP_HINT);
    });

    it("names setup off Windows, where only the function changes the folder", async () => {
        const f = fs({ "/usr/bin/wtp": "# wtp-launcher 3" });
        expect(await cdHint({ platform: "linux", env: { PATH: "/usr/bin" }, home: emptyHome() }, f)).toBe(SETUP_HINT);
    });
});
