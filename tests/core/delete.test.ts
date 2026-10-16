import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assign } from "../../src/core/assign.js";
import { resolveContext } from "../../src/core/context.js";
import { deleteSlot } from "../../src/core/delete.js";
import { markerPath, slotPath } from "../../src/core/naming.js";
import { loadPool } from "../../src/core/pool.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

describe("deleteSlot", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    const ctx = () => resolveContext(fx.root);
    const hasBranch = async (name: string) =>
        (await fx.git(fx.root, "branch", "--list", name)).trim() !== "";

    it("removes a clean slot and keeps its branch", async () => {
        const one = await fx.addWorktree(1, "feat/a");
        const r = await deleteSlot(await ctx(), 1);
        expect(r).toMatchObject({ index: 1, branch: "feat/a", branchDeleted: false });
        expect(existsSync(one)).toBe(false);
        expect((await loadPool(await ctx())).slots.map((s) => s.index)).toEqual([0]);
        expect(await hasBranch("feat/a")).toBe(true);
    });

    it("refuses a dirty slot unless discard is set", async () => {
        const one = await fx.addWorktree(1, "feat/a");
        await writeFile(path.join(one, "new.txt"), "x");
        await expect(deleteSlot(await ctx(), 1)).rejects.toThrow(/uncommitted/);
        expect(existsSync(one)).toBe(true);
        await deleteSlot(await ctx(), 1, { discard: true });
        expect(existsSync(one)).toBe(false);
    });

    it("deletes a merged branch on request", async () => {
        await fx.addWorktree(1, "feat/a");
        expect((await deleteSlot(await ctx(), 1, { deleteBranch: "safe" })).branchDeleted).toBe(true);
        expect(await hasBranch("feat/a")).toBe(false);
    });

    it("keeps an unmerged branch with a warning, unless forced", async () => {
        const one = await fx.addWorktree(1, "feat/a");
        await fx.commitFile(one, "a.txt", "work");
        const safe = await deleteSlot(await ctx(), 1, { deleteBranch: "safe" });
        expect(safe.branchDeleted).toBe(false);
        expect(safe.warnings[0]).toMatch(/not merged/);
        expect(await hasBranch("feat/a")).toBe(true);

        const two = await fx.addWorktree(2, "feat/b");
        await fx.commitFile(two, "b.txt", "work");
        expect((await deleteSlot(await ctx(), 2, { deleteBranch: "force" })).branchDeleted).toBe(true);
    });

    it("deletes a free slot and its marker", async () => {
        await fx.addWorktree(1, "feat/a");
        await fx.markFree(1);
        const r = await deleteSlot(await ctx(), 1);
        expect(r.branch).toBeNull();
        expect(existsSync(markerPath(fx.poolRoot, "my-repo", 1))).toBe(false);
    });

    it("cleans up a slot whose folder is missing", async () => {
        const one = await fx.addWorktree(1, "feat/a");
        await rm(one, { recursive: true, force: true });
        await deleteSlot(await ctx(), 1);
        expect((await loadPool(await ctx())).slots.map((s) => s.index)).toEqual([0]);
    });

    it("refuses slot 0, unknown slots, and unregistered folders", async () => {
        await expect(deleteSlot(await ctx(), 0)).rejects.toThrow(/never deletes/);
        await expect(deleteSlot(await ctx(), 4)).rejects.toThrow(/no slot 4/);
        const stray = slotPath(fx.poolRoot, "my-repo", 3);
        await mkdir(stray, { recursive: true });
        await expect(deleteSlot(await ctx(), 3)).rejects.toThrow(/not a registered worktree/);
        expect(existsSync(stray)).toBe(true);
    });

    it("needs unlock for a locked slot", async () => {
        const one = await fx.addWorktree(1, "feat/a");
        await fx.git(fx.root, "worktree", "lock", one);
        await expect(deleteSlot(await ctx(), 1)).rejects.toThrow(/locked/);
        await deleteSlot(await ctx(), 1, { unlock: true });
        expect(existsSync(one)).toBe(false);
    });

    it.runIf(process.platform === "win32")("refuses up front, and changes nothing, while another program is in the slot", async () => {
        const one = await fx.addWorktree(1, "feat/a");
        // A dev server or editor terminal whose cwd is the slot holds the folder on Windows.
        const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: one, stdio: "ignore" });
        await once(holder, "spawn");
        try {
            await expect(deleteSlot(await ctx(), 1)).rejects.toThrow(/A program holds files in it/);
            expect(existsSync(path.join(one, "README.md"))).toBe(true);
            expect((await loadPool(await ctx())).slots[1]).toMatchObject({ index: 1, state: "active" });
        }
        finally {
            holder.kill();
            await once(holder, "exit");
        }
        await deleteSlot(await ctx(), 1);
        expect(existsSync(one)).toBe(false);
    });

    it("lets the next assign reuse the deleted index", async () => {
        await fx.addWorktree(1, "a");
        await fx.addWorktree(2, "b");
        await fx.addWorktree(3, "c");
        await deleteSlot(await ctx(), 2);
        expect((await assign(await ctx(), "feat/next")).index).toBe(2);
    });
});
