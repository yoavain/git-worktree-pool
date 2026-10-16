import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assign } from "../../src/core/assign.js";
import { resolveContext } from "../../src/core/context.js";
import { describeLoss, free, inspectSlot } from "../../src/core/free.js";
import { markerPath } from "../../src/core/naming.js";
import { loadPool } from "../../src/core/pool.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

describe("inspectSlot", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    it("counts modified, untracked, and unpushed work", async () => {
        const one = await fx.addWorktree(1, "feat/a");
        await fx.commitFile(one, "a.txt", "committed, not pushed");
        await writeFile(path.join(one, "README.md"), "changed\n");
        await writeFile(path.join(one, "new.txt"), "x");
        expect(await inspectSlot(one)).toEqual({ branch: "feat/a", modified: 1, untracked: 1, unpushed: 1 });
    });

    it("describes what free discards", () => {
        expect(describeLoss({ branch: "feat/a", modified: 3, untracked: 2, unpushed: 1 })).toEqual([
            "3 modified and 2 untracked files will be discarded.",
            "1 commit is not on any remote. The branch keeps it.",
            "Ignored files (node_modules, build output) stay."
        ]);
        expect(describeLoss({ branch: "feat/a", modified: 0, untracked: 0, unpushed: 0 })).toEqual([
            "No uncommitted changes.",
            "Ignored files (node_modules, build output) stay."
        ]);
    });
});

describe("free", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    const ctx = () => resolveContext(fx.root);

    it("resets the folder, keeps ignored files, detaches HEAD, and writes the marker", async () => {
        const one = await fx.addWorktree(1, "feat/a");
        await writeFile(path.join(one, "README.md"), "changed\n");
        await writeFile(path.join(one, "new.txt"), "x");
        await writeFile(path.join(one, "ignored.txt"), "cache");
        const r = await free(await ctx(), 1);
        expect(r).toMatchObject({ index: 1, alreadyFree: false });
        expect((await fx.git(one, "status", "--porcelain")).trim()).toBe("");
        expect(existsSync(path.join(one, "new.txt"))).toBe(false);
        expect(existsSync(path.join(one, "ignored.txt"))).toBe(true);
        expect((await fx.git(one, "branch", "--show-current")).trim()).toBe("");
        expect(existsSync(markerPath(fx.poolRoot, "my-repo", 1))).toBe(true);
        expect((await loadPool(await ctx())).slots[1]?.state).toBe("free");
    });

    it("releases the branch so assign can use it again", async () => {
        await fx.addWorktree(1, "feat/a");
        await free(await ctx(), 1);
        expect((await assign(await ctx(), "feat/a")).index).toBe(1);
    });

    it("reports a slot that is already free", async () => {
        await fx.addWorktree(1, "feat/a");
        await fx.markFree(1);
        expect((await free(await ctx(), 1)).alreadyFree).toBe(true);
    });

    it("refuses slot 0 and unknown slots", async () => {
        await expect(free(await ctx(), 0)).rejects.toMatchObject({ name: "UserError" });
        await expect(free(await ctx(), 7)).rejects.toThrow(/no slot 7/);
    });

    it("needs force for a locked slot", async () => {
        const one = await fx.addWorktree(1, "feat/a");
        await fx.git(fx.root, "worktree", "lock", one);
        await expect(free(await ctx(), 1)).rejects.toThrow(/locked/);
        expect((await free(await ctx(), 1, { force: true })).alreadyFree).toBe(false);
    });
});
