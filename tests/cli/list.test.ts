import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { samePath } from "../../src/core/naming.js";
import { makeIo } from "../helpers/io.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

describe("wtp list / path", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    it("prints the table for list and ls", async () => {
        await fx.addWorktree(1, "feat/a");
        for (const cmd of ["list", "ls"]) {
            const t = makeIo(fx.root);
            expect(await main([cmd], t.io)).toBe(0);
            expect(t.out()).toContain("BRANCH");
            expect(t.out()).toContain("feat/a");
            expect(t.out()).toContain("next assign -> slot 2 (new)");
        }
    });

    it("prints JSON with --json", async () => {
        const t = makeIo(fx.root);
        expect(await main(["ls", "--json", "--no-changes"], t.io)).toBe(0);
        const data = JSON.parse(t.out());
        expect(data.slots[0]).toMatchObject({ index: 0, branch: "main", state: "root" });
        expect(data.nextAssign).toEqual({ index: 1, reuse: false });
    });

    it("prints a slot path", async () => {
        const one = await fx.addWorktree(1, "feat/a");
        const t = makeIo(fx.root);
        expect(await main(["path", "1"], t.io)).toBe(0);
        expect(samePath(t.out().trim(), one)).toBe(true);
    });

    it("fails with exit 1 for an unknown slot", async () => {
        const t = makeIo(fx.root);
        expect(await main(["path", "9"], t.io)).toBe(1);
        expect(t.err()).toContain("no slot 9");
    });

    it("fails with exit 1 for a bad index", async () => {
        const t = makeIo(fx.root);
        expect(await main(["path", "x"], t.io)).toBe(1);
    });

    it("fails with exit 1 for an unknown command", async () => {
        const t = makeIo(fx.root);
        expect(await main(["frobnicate"], t.io)).toBe(1);
        expect(t.err()).toContain("Unknown command");
    });

    it("fails with exit 2 outside a repo", async () => {
        const outside = await mkdtemp(path.join(os.tmpdir(), "wtp-out-"));
        try {
            const t = makeIo(outside);
            expect(await main(["ls"], t.io)).toBe(2);
        }
        finally {
            await rm(outside, { recursive: true, force: true });
        }
    });

    it("prints the package version", async () => {
        const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
        const t = makeIo(fx.root);
        expect(await main(["--version"], t.io)).toBe(0);
        expect(t.out().trim()).toBe(pkg.version);
    });

    it("prints help", async () => {
        const t = makeIo(fx.root);
        expect(await main(["help"], t.io)).toBe(0);
        expect(t.out()).toContain("wtp assign <branch>");
    });
});
