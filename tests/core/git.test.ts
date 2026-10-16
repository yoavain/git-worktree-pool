import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit, tryGit } from "../../src/core/git.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

describe("git runner", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    it("returns stdout", async () => {
        expect((await runGit(["rev-parse", "--abbrev-ref", "HEAD"], fx.root)).trim()).toBe("main");
    });

    it("throws GitError with exit code 3", async () => {
        await expect(runGit(["rev-parse", "--verify", "nope"], fx.root))
            .rejects.toMatchObject({ name: "GitError", exitCode: 3 });
    });

    it("reports failure without throwing in tryGit", async () => {
        const r = await tryGit(["rev-parse", "--verify", "nope"], fx.root);
        expect(r.ok).toBe(false);
        expect(r.stderr).not.toBe("");
    });

    it("reports a missing folder as a failure", async () => {
        const r = await tryGit(["status"], fx.root + "-does-not-exist");
        expect(r.ok).toBe(false);
    });

    it("builds a fixture with main pushed to origin", async () => {
        const local = (await fx.git(fx.root, "rev-parse", "main")).trim();
        const remote = (await fx.git(fx.root, "rev-parse", "origin/main")).trim();
        expect(remote).toBe(local);
    });

    it("adds worktrees and marks them free", async () => {
        const dir = await fx.addWorktree(1, "feat/a");
        expect((await fx.git(dir, "branch", "--show-current")).trim()).toBe("feat/a");
        await fx.markFree(1);
        expect((await fx.git(dir, "branch", "--show-current")).trim()).toBe("");
    });
});
