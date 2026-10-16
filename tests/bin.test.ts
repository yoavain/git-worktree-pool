import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("the bin entry", () => {
    it("keeps the shebang, or npm's shim hands wtp.js to the Windows file association", async () => {
        const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { bin: Record<string, string> };
        expect(pkg.bin).toEqual({ "worktree-pool": "dist/bin/wtp.js" });
        const src = await readFile(new URL("../src/bin/wtp.ts", import.meta.url), "utf8");
        expect(src.startsWith("#!/usr/bin/env node\n")).toBe(true);
    });
});
