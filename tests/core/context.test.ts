import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig } from "../../src/core/config.js";
import { resolveContext, type Context } from "../../src/core/context.js";
import { samePath } from "../../src/core/naming.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

describe("resolveContext", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo("my-repo", { parentName: "dir with space ü" });
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    function expectContext(ctx: Context) {
        expect(samePath(ctx.root, fx.root)).toBe(true);
        expect(ctx.repoName).toBe("my-repo");
        expect(samePath(ctx.poolRoot, fx.poolRoot)).toBe(true);
    }

    it("works from the clone root", async () => {
        expectContext(await resolveContext(fx.root));
    });

    it("works from a subfolder of the clone", async () => {
        const sub = path.join(fx.root, "src", "deep");
        await mkdir(sub, { recursive: true });
        expectContext(await resolveContext(sub));
    });

    it("works from a slot and from a slot subfolder", async () => {
        const slot = await fx.addWorktree(1, "feat/a");
        expectContext(await resolveContext(slot));
        const sub = path.join(slot, "nested");
        await mkdir(sub);
        expectContext(await resolveContext(sub));
    });

    it("works from the pool root", async () => {
        await mkdir(fx.poolRoot, { recursive: true });
        expectContext(await resolveContext(fx.poolRoot));
    });

    it("keeps the start folder as cwd", async () => {
        const ctx = await resolveContext(fx.root);
        expect(samePath(ctx.cwd, fx.root)).toBe(true);
    });

    it("fails with exit code 2 outside any repo or pool", async () => {
        const outside = await mkdtemp(path.join(os.tmpdir(), "wtp-outside-"));
        try {
            await expect(resolveContext(outside)).rejects.toMatchObject({ name: "ContextError", exitCode: 2 });
        }
        finally {
            await rm(outside, { recursive: true, force: true });
        }
    });

    it("fails with exit code 2 for a pool with no clone next to it", async () => {
        const ghost = path.join(fx.parent, "ghost-wt-pool");
        await mkdir(ghost);
        await expect(resolveContext(ghost)).rejects.toMatchObject({ exitCode: 2 });
    });
});

describe("resolveContext letter case", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo("My-Repo");
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    it.runIf(process.platform === "win32")("uses the real folder case when started from the pool root typed in another case", async () => {
        await fx.addWorktree(1, "feat/a");
        const typed = path.join(fx.parent, "my-repo-wt-pool");
        const ctx = await resolveContext(typed);
        expect(ctx.repoName).toBe("My-Repo");
        expect(path.basename(ctx.poolRoot)).toBe("My-Repo-wt-pool");
    });
});

describe("readConfig", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    it("uses main and origin by default", async () => {
        expect(await readConfig(fx.root)).toEqual({ base: "main", remote: "origin" });
    });

    it("reads wtp.base and wtp.remote", async () => {
        await fx.git(fx.root, "config", "wtp.base", "develop");
        await fx.git(fx.root, "config", "wtp.remote", "upstream");
        expect(await readConfig(fx.root)).toEqual({ base: "develop", remote: "upstream" });
    });
});
