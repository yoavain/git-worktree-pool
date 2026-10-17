import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findCheckout, listBranches, resolveBranch, takenBranches } from "../../src/core/branch.js";
import { readConfig } from "../../src/core/config.js";
import { resolveContext } from "../../src/core/context.js";
import { loadPool } from "../../src/core/pool.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

describe("resolveBranch", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    const resolve = async (name: string) => {
        const ctx = await resolveContext(fx.root);
        return resolveBranch(ctx, name, await readConfig(fx.root));
    };

    it("uses a local branch first", async () => {
        await fx.git(fx.root, "branch", "feat/local");
        expect((await resolve("feat/local")).plan).toEqual({ kind: "local", name: "feat/local" });
    });

    it("fetches and uses a remote-only branch", async () => {
        await fx.pushRemoteOnlyBranch("feat/remote");
        expect((await resolve("feat/remote")).plan).toEqual({ kind: "remote", name: "feat/remote", remote: "origin" });
    });

    it("ignores a stale remote-tracking ref after the remote branch is deleted", async () => {
        await fx.pushRemoteOnlyBranch("feat/gone");
        await fx.git(fx.root, "fetch", "origin");
        await fx.git(fx.origin, "branch", "-D", "feat/gone");
        const r = await resolve("feat/gone");
        expect(r.plan).toEqual({ kind: "new", name: "feat/gone", base: "main" });
        expect(r.warning).toBeUndefined();
    });

    it("plans a new branch from local main", async () => {
        const r = await resolve("feat/new");
        expect(r.plan).toEqual({ kind: "new", name: "feat/new", base: "main" });
        expect(r.warning).toBeUndefined();
    });

    it("rejects an invalid branch name", async () => {
        await expect(resolve("bad..name")).rejects.toMatchObject({ name: "UserError" });
    });

    it("rejects a missing base branch", async () => {
        await fx.git(fx.root, "config", "wtp.base", "develop");
        await expect(resolve("feat/new")).rejects.toThrow(/develop/);
    });

    it("works without a remote", async () => {
        await fx.git(fx.root, "remote", "remove", "origin");
        expect((await resolve("feat/new")).plan.kind).toBe("new");
    });

    it("warns and goes on when the remote cannot be reached", async () => {
        await fx.git(fx.root, "remote", "set-url", "origin", path.join(fx.tmp, "missing.git"));
        const r = await resolve("feat/new");
        expect(r.plan.kind).toBe("new");
        expect(r.warning).toMatch(/Could not fetch/);
    });
});

describe("findCheckout and listBranches", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    it("finds the slot that has a branch", async () => {
        await fx.addWorktree(1, "feat/a");
        await fx.git(fx.root, "worktree", "add", "-b", "side", path.join(fx.parent, "elsewhere"), "main");
        const pool = await loadPool(await resolveContext(fx.root));
        expect(findCheckout(pool, "main")?.index).toBe(0);
        expect(findCheckout(pool, "feat/a")?.index).toBe(1);
        expect(findCheckout(pool, "side")?.index).toBeNull();
        expect(findCheckout(pool, "nope")).toBeNull();
        expect([...takenBranches(pool)].sort()).toEqual(["feat/a", "main", "side"]);
    });

    it("lists local branches first and removes remote duplicates", async () => {
        await fx.git(fx.root, "branch", "feat/a");
        await fx.pushRemoteOnlyBranch("feat/r");
        await fx.git(fx.root, "fetch", "origin");
        const ctx = await resolveContext(fx.root);
        expect(await listBranches(ctx, await readConfig(fx.root))).toEqual([
            { name: "feat/a", source: "local" },
            { name: "main", source: "local" },
            { name: "feat/r", source: "remote" }
        ]);
    });
});
