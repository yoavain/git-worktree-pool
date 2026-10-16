import { describe, expect, it } from "vitest";
import { findAllOnPath, findOnPath, pathDirs, sameDir } from "../../src/platform/path-search.js";

const files = (...list: string[]) => {
    const set = new Set(list.map((f) => f.toLowerCase()));
    return (p: string) => set.has(p.toLowerCase());
};

describe("findOnPath", () => {
    it("tries each PATHEXT inside a folder before the next folder", () => {
        const deps = {
            platform: "win32" as const,
            env: { PATH: "C:\\a;C:\\b", PATHEXT: ".COM;.EXE;.BAT;.CMD" },
            isFile: files("C:\\a\\tool.cmd", "C:\\a\\tool.exe", "C:\\b\\tool.exe")
        };
        expect(findOnPath("tool", deps)).toBe("C:\\a\\tool.exe");
        expect(findAllOnPath("tool", deps)).toEqual(["C:\\a\\tool.exe", "C:\\a\\tool.cmd", "C:\\b\\tool.exe"]);
    });

    it("uses the default PATHEXT when the variable is missing", () => {
        const deps = { platform: "win32" as const, env: { PATH: "C:\\a" }, isFile: files("C:\\a\\tool.cmd") };
        expect(findOnPath("tool", deps)).toBe("C:\\a\\tool.cmd");
    });

    it("accepts explicit extensions, such as the bare name", () => {
        const deps = { platform: "win32" as const, env: { PATH: "C:\\a" }, isFile: files("C:\\a\\wtp", "C:\\a\\wtp.ps1") };
        expect(findAllOnPath("wtp", { ...deps, exts: [".ps1", ""] })).toEqual(["C:\\a\\wtp.ps1", "C:\\a\\wtp"]);
    });

    it("uses the exact name and \":\" off Windows", () => {
        const deps = { platform: "linux" as const, env: { PATH: "/x:/y" }, isFile: files("/y/tool", "/x/tool.cmd") };
        expect(findOnPath("tool", deps)).toBe("/y/tool");
    });

    it("returns null when nothing matches", () => {
        expect(findOnPath("tool", { platform: "linux", env: {}, isFile: () => false })).toBeNull();
    });
});

describe("pathDirs", () => {
    it("drops empty entries and quotes", () => {
        expect(pathDirs({ platform: "win32", env: { PATH: "\"C:\\a b\";;C:\\c;" } })).toEqual(["C:\\a b", "C:\\c"]);
        expect(pathDirs({ platform: "win32", env: { Path: "C:\\a" } })).toEqual(["C:\\a"]);
    });
});

describe("sameDir", () => {
    it("ignores case and a trailing backslash on Windows", () => {
        expect(sameDir("C:\\Users\\Me\\Apps\\", "c:\\users\\me\\apps", "win32")).toBe(true);
        expect(sameDir("C:\\a", "C:\\b", "win32")).toBe(false);
    });

    it("keeps case off Windows", () => {
        expect(sameDir("/a/B", "/a/b", "linux")).toBe(false);
        expect(sameDir("/a/b/", "/a/b", "linux")).toBe(true);
    });
});
