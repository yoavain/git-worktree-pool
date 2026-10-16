import { describe, expect, it } from "vitest";
import { cdHint, FUNCTION_HINT, SETUP_HINT, USE_WTP_HINT } from "../../src/cli/move.js";
import type { FsDeps } from "../../src/platform/launchers.js";

const fs = (files: Record<string, string>): FsDeps => ({
    isFile: (p) => p in files,
    readHead: (p) => files[p] ?? null,
    isWritableDir: () => true
});

describe("cdHint", () => {
    it("names setup when nothing is set up", () => {
        expect(cdHint({ platform: "win32", env: { PATH: "C:\\bin" } }, fs({}))).toBe(SETUP_HINT);
        expect(SETUP_HINT).toContain("worktree-pool setup");
    });

    it("says to use wtp when a launcher exists on Windows", () => {
        const f = fs({ "C:\\bin\\wtp.cmd": "rem wtp-launcher 1" });
        expect(cdHint({ platform: "win32", env: { PATH: "C:\\bin" } }, f)).toBe(USE_WTP_HINT);
    });

    it("ignores a wtp that is not a launcher", () => {
        const f = fs({ "C:\\bin\\wtp.cmd": "@echo other" });
        expect(cdHint({ platform: "win32", env: { PATH: "C:\\bin" } }, f)).toBe(SETUP_HINT);
    });

    it("asks for the function when the sh launcher ran", () => {
        const f = fs({ "C:\\bin\\wtp.cmd": "rem wtp-launcher 1" });
        expect(cdHint({ platform: "win32", env: { PATH: "C:\\bin", WTP_VIA: "sh" } }, f)).toBe(FUNCTION_HINT);
        expect(FUNCTION_HINT).toContain("worktree-pool setup");
    });

    it("names setup off Windows, where only the function changes the folder", () => {
        const f = fs({ "/usr/bin/wtp": "# wtp-launcher 1" });
        expect(cdHint({ platform: "linux", env: { PATH: "/usr/bin" } }, f)).toBe(SETUP_HINT);
    });
});
