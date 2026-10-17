import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveContext } from "../../src/core/context.js";
import { markerPath, samePath, slotPath } from "../../src/core/naming.js";
import {
    chooseSlot, loadPool, problemLabel, repairPool
} from "../../src/core/pool.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

describe("loadPool", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    it("lists only the root in a fresh repo", async () => {
        const pool = await loadPool(await resolveContext(fx.root));
        expect(pool.slots).toHaveLength(1);
        expect(pool.slots[0]).toMatchObject({ index: 0, branch: "main", state: "root", isCurrent: true });
    });

    it("reads active and free slots and finds the current slot from a subfolder", async () => {
        const one = await fx.addWorktree(1, "feat/a");
        await fx.addWorktree(3, "feat/c");
        await fx.markFree(3);
        const sub = path.join(one, "sub");
        await mkdir(sub);
        const pool = await loadPool(await resolveContext(sub));
        expect(pool.slots.map((s) => [s.index, s.state, s.branch])).toEqual([
            [0, "root", "main"], [1, "active", "feat/a"], [3, "free", null]
        ]);
        expect(pool.slots.find((s) => s.isCurrent)?.index).toBe(1);
        expect(samePath(pool.slots[1]!.path, one)).toBe(true);
    });

    it("lists worktrees outside the pool as external", async () => {
        const elsewhere = path.join(fx.parent, "elsewhere");
        await fx.git(fx.root, "worktree", "add", "-b", "side", elsewhere, "main");
        const pool = await loadPool(await resolveContext(fx.root));
        expect(pool.external).toHaveLength(1);
        expect(pool.external[0]?.branch).toBe("side");
    });

    it("marks broken slots: missing folder, orphan marker, unregistered folder", async () => {
        const two = await fx.addWorktree(2, "feat/b");
        await rm(two, { recursive: true, force: true });
        await mkdir(fx.poolRoot, { recursive: true });
        await writeFile(markerPath(fx.poolRoot, "my-repo", 5), "");
        await mkdir(slotPath(fx.poolRoot, "my-repo", 4));
        const pool = await loadPool(await resolveContext(fx.root));
        const byIndex = new Map(pool.slots.map((s) => [s.index, s]));
        expect(byIndex.get(2)).toMatchObject({ state: "broken", problem: "missing" });
        expect(byIndex.get(4)).toMatchObject({ state: "broken", problem: "unregistered" });
        expect(byIndex.get(5)).toMatchObject({ state: "broken", problem: "orphan-marker" });
        expect(problemLabel("missing")).toBe("folder is missing");
        expect(problemLabel(undefined)).toBe("unknown problem");
    });

    it("loads change counts on request", async () => {
        const one = await fx.addWorktree(1, "feat/a");
        await writeFile(path.join(one, "README.md"), "hello\nworld\n");
        await writeFile(path.join(one, "new.txt"), "x");
        const pool = await loadPool(await resolveContext(fx.root), { changes: true });
        expect(pool.slots[1]?.changes).toMatchObject({ added: 1, removed: 0, untracked: 1 });
        expect(pool.slots[0]?.changes).toMatchObject({ added: 0, removed: 0, untracked: 0 });
    });
});

describe("chooseSlot", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    it("starts at 1", async () => {
        expect(chooseSlot(await loadPool(await resolveContext(fx.root)))).toEqual({ index: 1, reuse: false });
    });

    it("prefers the lowest free slot over an unused index", async () => {
        await fx.addWorktree(1, "a");
        await fx.addWorktree(3, "c");
        await fx.addWorktree(4, "d");
        await fx.markFree(4);
        await fx.markFree(3);
        expect(chooseSlot(await loadPool(await resolveContext(fx.root)))).toEqual({ index: 3, reuse: true });
    });

    it("uses the lowest unused index when nothing is free", async () => {
        await fx.addWorktree(1, "a");
        await fx.addWorktree(3, "c");
        expect(chooseSlot(await loadPool(await resolveContext(fx.root)))).toEqual({ index: 2, reuse: false });
    });

    it("skips the index of an unregistered folder", async () => {
        await fx.addWorktree(1, "a");
        await mkdir(slotPath(fx.poolRoot, "my-repo", 2));
        expect(chooseSlot(await loadPool(await resolveContext(fx.root)))).toEqual({ index: 3, reuse: false });
    });
});

describe("repairPool", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    it("prunes missing worktrees and orphan markers, and keeps unregistered folders", async () => {
        const two = await fx.addWorktree(2, "feat/b");
        await rm(two, { recursive: true, force: true });
        await writeFile(markerPath(fx.poolRoot, "my-repo", 5), "");
        const stray = slotPath(fx.poolRoot, "my-repo", 4);
        await mkdir(stray);
        const ctx = await resolveContext(fx.root);
        const fixed = await repairPool(ctx);
        expect(fixed).toHaveLength(2);
        const pool = await loadPool(ctx);
        expect(pool.slots.map((s) => [s.index, s.problem])).toEqual([[0, undefined], [4, "unregistered"]]);
    });
});
