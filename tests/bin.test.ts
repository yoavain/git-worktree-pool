import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));

describe("the bin entry", () => {
    it("keeps the shebang, or npm's shim hands wtp.js to the Windows file association", async () => {
        const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { bin: Record<string, string> };
        expect(pkg.bin).toEqual({ "worktree-pool": "dist/bin/wtp.js" });
        const src = await readFile(new URL("../src/bin/wtp.ts", import.meta.url), "utf8");
        expect(src.startsWith("#!/usr/bin/env node\n")).toBe(true);
    });

    it("stays LF on every checkout, so the shebang never ends in a CR", async () => {
        // A Windows checkout turns text files into CRLF, and "node\r" is not a program on Linux or macOS.
        const { stdout } = await run("git", ["check-attr", "eol", "--", "src/bin/wtp.ts"], { cwd: root });
        expect(stdout.trim()).toBe("src/bin/wtp.ts: eol: lf");
    });
});
