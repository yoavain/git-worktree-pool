import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assign } from "../../src/core/assign.js";
import { resolveContext } from "../../src/core/context.js";
import { markerPath, samePath, slotPath } from "../../src/core/naming.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

describe("assign", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo("my-repo", { parentName: "dir with space ü" });
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    const ctx = () => resolveContext(fx.root);
    const current = async (dir: string) => (await fx.git(dir, "branch", "--show-current")).trim();

    it("creates slot 1 with a new branch from local main, and creates the pool root", async () => {
        await fx.commitFile(fx.root, "local-only.txt", "not pushed");
        const r = await assign(await ctx(), "feat/new");
        expect(r).toMatchObject({ index: 1, reused: false, createdPoolRoot: true, plan: { kind: "new", base: "main" } });
        expect(samePath(r.path, slotPath(fx.poolRoot, "my-repo", 1))).toBe(true);
        expect(await current(r.path)).toBe("feat/new");
        const tip = (await fx.git(fx.root, "rev-parse", "feat/new")).trim();
        expect(tip).toBe((await fx.git(fx.root, "rev-parse", "main")).trim());
    });

    it("uses an existing local branch", async () => {
        await fx.git(fx.root, "branch", "feat/local");
        const r = await assign(await ctx(), "feat/local");
        expect(r.plan.kind).toBe("local");
        expect(await current(r.path)).toBe("feat/local");
    });

    it("tracks a remote-only branch", async () => {
        await fx.pushRemoteOnlyBranch("feat/remote");
        const r = await assign(await ctx(), "feat/remote");
        expect(r.plan.kind).toBe("remote");
        expect((await fx.git(r.path, "rev-parse", "--abbrev-ref", "@{upstream}")).trim()).toBe("origin/feat/remote");
    });

    it("accepts branch names with several slashes", async () => {
        const r = await assign(await ctx(), "feature/a/b");
        expect(await current(r.path)).toBe("feature/a/b");
    });

    it("reuses the lowest free slot, keeps ignored files, and removes the marker", async () => {
        const one = await fx.addWorktree(1, "old");
        await writeFile(path.join(one, "ignored.txt"), "warm cache");
        await fx.markFree(1);
        await fx.git(fx.root, "branch", "existing");
        const r = await assign(await ctx(), "existing");
        expect(r).toMatchObject({ index: 1, reused: true, createdPoolRoot: false });
        expect(await current(one)).toBe("existing");
        expect(existsSync(path.join(one, "ignored.txt"))).toBe(true);
        expect(existsSync(markerPath(fx.poolRoot, "my-repo", 1))).toBe(false);
    });

    it("prefers a free slot over an unused index", async () => {
        await fx.addWorktree(1, "a");
        await fx.addWorktree(3, "c");
        await fx.markFree(3);
        expect((await assign(await ctx(), "feat/x")).index).toBe(3);
    });

    it("fills the lowest unused index when no slot is free", async () => {
        await fx.addWorktree(1, "a");
        await fx.addWorktree(3, "c");
        expect((await assign(await ctx(), "feat/x")).index).toBe(2);
    });

    it("skips the index of a leftover folder", async () => {
        await mkdir(slotPath(fx.poolRoot, "my-repo", 1), { recursive: true });
        expect((await assign(await ctx(), "feat/x")).index).toBe(2);
    });

    it("refuses a branch that is checked out in another worktree", async () => {
        await fx.addWorktree(1, "feat/a");
        await expect(assign(await ctx(), "feat/a")).rejects.toMatchObject({ name: "BranchInUseError", index: 1 });
        await expect(assign(await ctx(), "main")).rejects.toMatchObject({ name: "BranchInUseError", index: 0 });
    });

    it("gives two parallel assigns two different slots", async () => {
        const c = await ctx();
        const [a, b] = await Promise.all([assign(c, "feat/p1"), assign(c, "feat/p2")]);
        expect(new Set([a.index, b.index])).toEqual(new Set([1, 2]));
    });

    it("passes on a fetch warning", async () => {
        await fx.git(fx.root, "remote", "set-url", "origin", path.join(fx.tmp, "missing.git"));
        const r = await assign(await ctx(), "feat/offline");
        expect(r.warnings[0]).toMatch(/Could not fetch/);
    });
});
