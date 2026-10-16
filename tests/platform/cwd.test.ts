import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handoffCwd } from "../../src/platform/cwd.js";
import { findGitBash, gitBashFromExecPath } from "../../src/platform/git-bash.js";

describe("handoffCwd", () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), "wtp-cwd-"));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("writes the folder to WTP_CWD_FILE", async () => {
        const file = path.join(dir, "cwd");
        expect(await handoffCwd("C:\\dir with space ü\\my-repo-wt-1", { WTP_CWD_FILE: file })).toBe(true);
        expect(await readFile(file, "utf8")).toBe("C:\\dir with space ü\\my-repo-wt-1");
    });

    it("returns false without shell integration", async () => {
        expect(await handoffCwd("/x", {})).toBe(false);
    });
});

describe("findGitBash", () => {
    it("derives bash.exe from the git exec path", () => {
        expect(gitBashFromExecPath("C:/Program Files/Git/mingw64/libexec/git-core")).toEqual([
            "C:\\Program Files\\Git\\bin\\bash.exe",
            "C:\\Program Files\\Git\\usr\\bin\\bash.exe"
        ]);
    });

    it("returns the first candidate that exists on Windows", async () => {
        const found = await findGitBash({
            platform: "win32",
            execPath: async () => "C:/Program Files/Git/mingw64/libexec/git-core",
            exists: (p) => p.endsWith("usr\\bin\\bash.exe")
        });
        expect(found).toBe("C:\\Program Files\\Git\\usr\\bin\\bash.exe");
    });

    it("returns null on Windows when nothing exists", async () => {
        expect(await findGitBash({ platform: "win32", execPath: async () => null, exists: () => false })).toBeNull();
    });

    it("uses bash from PATH elsewhere", async () => {
        expect(await findGitBash({ platform: "linux" })).toBe("bash");
    });
});
