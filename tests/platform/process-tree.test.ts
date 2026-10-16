import { describe, expect, it } from "vitest";
import { chainFrom, parentChain, parseProcessList, PROCESS_QUERY } from "../../src/platform/process-tree.js";

const LIST = [
    "0|0|",
    "4|0|",
    "100|4|C:\\Windows\\explorer.exe",
    "200|100|C:\\Users\\J\u00fcrgen\\AppData\\Local\\nvm\\.nodejs\\worktree-pool.exe",
    "300|200|C:\\Windows\\system32\\cmd.exe",
    "400|300|C:\\nvm\\installs\\v26\\node.exe",
    ""
].join("\r\n");

describe("parseProcessList", () => {
    it("reads pid, parent pid, and the executable path", () => {
        const procs = parseProcessList(LIST);
        expect(procs.get(300)).toEqual({ pid: 300, ppid: 200, exe: "C:\\Windows\\system32\\cmd.exe" });
        expect(procs.get(4)?.exe).toBe("");
    });

    it("keeps non-ASCII executable paths", () => {
        expect(parseProcessList(LIST).get(200)?.exe).toContain("J\u00fcrgen");
    });

    it("asks PowerShell for UTF-8 output", () => {
        expect(PROCESS_QUERY).toContain("[Console]::OutputEncoding = [Text.Encoding]::UTF8");
    });
});

describe("chainFrom", () => {
    it("walks up from the start process", () => {
        expect(chainFrom(parseProcessList(LIST), 300).map((p) => p.pid)).toEqual([300, 200, 100, 4, 0]);
    });

    it("stops at a missing process, a loop, and the limit", () => {
        const procs = parseProcessList("1|2|a\n2|1|b\n5|9|c\n");
        expect(chainFrom(procs, 5).map((p) => p.pid)).toEqual([5]);
        expect(chainFrom(procs, 1).map((p) => p.pid)).toEqual([1, 2]);
        expect(chainFrom(parseProcessList(LIST), 400, 2).map((p) => p.pid)).toEqual([400, 300]);
    });
});

describe("parentChain", () => {
    it("returns nothing off Windows", async () => {
        expect(await parentChain(1, { platform: "linux", run: async () => LIST })).toEqual([]);
    });

    it("queries powershell.exe once", async () => {
        const calls: string[][] = [];
        const chain = await parentChain(300, { platform: "win32", run: async (cmd, args) => {
            calls.push([cmd, ...args]);
            return LIST;
        } });
        expect(chain[1]?.exe).toMatch(/worktree-pool\.exe$/);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.[0]).toBe("powershell.exe");
    });

    it("returns nothing when the query fails", async () => {
        expect(await parentChain(300, { platform: "win32", run: async () => {
            throw new Error("no");
        } })).toEqual([]);
    });
});
