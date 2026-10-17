import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { markerPath, samePath, slotPath } from "../../src/core/naming.js";
import { makeIo } from "../helpers/io.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

describe("mutating commands", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo("my-repo", { parentName: "dir with space ü" });
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    const slot = (n: number) => slotPath(fx.poolRoot, "my-repo", n);

    it("prints no TUI glyphs in plain output (the fixture path itself has a u-umlaut)", async () => {
        const glyphs = /[→✓·↑↓—●…]/;
        for (const argv of [["assign", "feat/x"], ["switch", "1"], ["list"], ["free", "1", "--yes"], ["delete", "1", "--yes"]]) {
            const t = makeIo(fx.root, { answer: true });
            expect(await main(argv, t.io)).toBe(0);
            expect(t.out() + t.err()).not.toMatch(glyphs);
        }
    });

    describe("assign", () => {
        it("creates a slot, copies the path, hands the path to the shell, and prints the table", async () => {
            const t = makeIo(fx.root);
            expect(await main(["assign", "feat/x"], t.io)).toBe(0);
            expect(samePath(t.copies[0]!, slot(1))).toBe(true);
            expect(samePath(await t.cwdTarget(), slot(1))).toBe(true);
            expect(t.err()).toContain("-> slot 1 (new)");
            expect(t.out()).toContain("feat/x");
        });

        it("copies but does not cd with --no-cd", async () => {
            const t = makeIo(fx.root);
            expect(await main(["assign", "feat/x", "--no-cd"], t.io)).toBe(0);
            expect(t.copies).toHaveLength(1);
            expect(await t.cwdTarget()).toBe("");
        });

        it("prints the setup hint without shell integration", async () => {
            const t = makeIo(fx.root, { integration: false });
            expect(await main(["assign", "feat/x"], t.io)).toBe(0);
            expect(t.err()).toContain("worktree-pool setup");
        });

        it("names the slot that already has the branch", async () => {
            await fx.addWorktree(1, "feat/a");
            const t = makeIo(fx.root);
            expect(await main(["assign", "feat/a"], t.io)).toBe(1);
            expect(t.err()).toContain("wtp switch 1");
        });

        it("offers to switch to the slot that has the branch in a terminal", async () => {
            await fx.addWorktree(1, "feat/a");
            const t = makeIo(fx.root, { tty: true, answer: true });
            expect(await main(["assign", "feat/a"], t.io)).toBe(0);
            expect(t.questions).toEqual(["feat/a is already in slot 1. Switch there?"]);
            expect(samePath(await t.cwdTarget(), slot(1))).toBe(true);
        });

        it("stays put when the user declines the switch", async () => {
            await fx.addWorktree(1, "feat/a");
            const t = makeIo(fx.root, { tty: true, answer: false });
            expect(await main(["assign", "feat/a"], t.io)).toBe(1);
            expect(await t.cwdTarget()).toBe("");
        });

        it("needs a branch name", async () => {
            const t = makeIo(fx.root);
            expect(await main(["assign"], t.io)).toBe(1);
            expect(t.err()).toContain("Usage: wtp assign <branch>");
        });
    });

    describe("switch", () => {
        it("copies the path and hands it to the shell", async () => {
            await fx.addWorktree(2, "feat/b");
            const t = makeIo(fx.root);
            expect(await main(["switch", "2"], t.io)).toBe(0);
            expect(samePath(t.copies[0]!, slot(2))).toBe(true);
            expect(samePath(await t.cwdTarget(), slot(2))).toBe(true);
        });

        it("switches to the root with 0", async () => {
            const one = await fx.addWorktree(1, "feat/a");
            const t = makeIo(one);
            expect(await main(["switch", "0"], t.io)).toBe(0);
            expect(samePath(await t.cwdTarget(), fx.root)).toBe(true);
        });

        it("warns about a free slot and still switches", async () => {
            await fx.addWorktree(1, "feat/a");
            await fx.markFree(1);
            const t = makeIo(fx.root);
            expect(await main(["switch", "1"], t.io)).toBe(0);
            expect(t.err()).toContain("is free");
        });

        it("fails for an unknown slot", async () => {
            const t = makeIo(fx.root);
            expect(await main(["switch", "5"], t.io)).toBe(1);
            expect(t.err()).toContain("Valid slots: 0");
        });

        it("rejects --no-cd and points to wtp path", async () => {
            await fx.addWorktree(1, "feat/a");
            const t = makeIo(fx.root);
            expect(await main(["switch", "1", "--no-cd"], t.io)).toBe(1);
            expect(t.err()).toContain("wtp path 1");
            expect(await t.cwdTarget()).toBe("");
        });
    });

    describe("free", () => {
        it("asks first and changes nothing on no", async () => {
            const one = await fx.addWorktree(1, "feat/a");
            await writeFile(path.join(one, "new.txt"), "x");
            const t = makeIo(fx.root, { answer: false });
            expect(await main(["free", "1"], t.io)).toBe(1);
            expect(t.questions).toHaveLength(1);
            expect(t.err()).toContain("1 untracked files will be discarded");
            expect(existsSync(path.join(one, "new.txt"))).toBe(true);
        });

        it("frees on yes", async () => {
            await fx.addWorktree(1, "feat/a");
            const t = makeIo(fx.root, { answer: true });
            expect(await main(["free", "1"], t.io)).toBe(0);
            expect(existsSync(markerPath(fx.poolRoot, "my-repo", 1))).toBe(true);
            expect(t.err()).toContain("Slot 1 is free.\n");
        });

        it("skips the question with --yes", async () => {
            await fx.addWorktree(1, "feat/a");
            const t = makeIo(fx.root);
            expect(await main(["free", "1", "--yes"], t.io)).toBe(0);
            expect(t.questions).toHaveLength(0);
        });

        it("moves the shell to the root when it is in the freed slot", async () => {
            const one = await fx.addWorktree(1, "feat/a");
            const t = makeIo(one);
            expect(await main(["free", "1", "-y"], t.io)).toBe(0);
            expect(samePath(await t.cwdTarget(), fx.root)).toBe(true);
            expect(t.copies).toHaveLength(0);
        });

        it("refuses slot 0 before it asks", async () => {
            const t = makeIo(fx.root, { answer: true });
            expect(await main(["free", "0"], t.io)).toBe(1);
            expect(t.questions).toHaveLength(0);
        });
    });

    describe("delete", () => {
        it("asks, then removes the slot", async () => {
            const one = await fx.addWorktree(1, "feat/a");
            const t = makeIo(fx.root, { answer: true });
            expect(await main(["delete", "1"], t.io)).toBe(0);
            expect(t.questions).toHaveLength(1);
            expect(existsSync(one)).toBe(false);
        });

        it("deletes a dirty slot after a yes", async () => {
            const one = await fx.addWorktree(1, "feat/a");
            await writeFile(path.join(one, "new.txt"), "x");
            const t = makeIo(fx.root, { answer: true });
            expect(await main(["delete", "1"], t.io)).toBe(0);
            expect(existsSync(one)).toBe(false);
        });

        it("deletes a dirty slot with --yes, like free --yes", async () => {
            const one = await fx.addWorktree(1, "feat/a");
            await writeFile(path.join(one, "new.txt"), "x");
            const t = makeIo(fx.root);
            expect(await main(["delete", "1", "--yes"], t.io)).toBe(0);
            expect(t.questions).toHaveLength(0);
            expect(existsSync(one)).toBe(false);
        });

        it("still refuses a locked slot with --yes but no --force", async () => {
            const one = await fx.addWorktree(1, "feat/a");
            await fx.git(fx.root, "worktree", "lock", one);
            const t = makeIo(fx.root);
            expect(await main(["delete", "1", "--yes"], t.io)).toBe(1);
            expect(t.err()).toContain("--force");
            expect(existsSync(one)).toBe(true);
        });

        it("deletes the merged branch with --branch", async () => {
            await fx.addWorktree(1, "feat/a");
            const t = makeIo(fx.root);
            expect(await main(["delete", "1", "--yes", "--branch"], t.io)).toBe(0);
            expect((await fx.git(fx.root, "branch", "--list", "feat/a")).trim()).toBe("");
            expect(t.err()).toContain("Slot 1 is deleted. The branch feat/a is deleted too.\n");
        });

        it("says the commits are lost when --branch --force deletes an unmerged branch", async () => {
            const one = await fx.addWorktree(1, "feat/a");
            await fx.commitFile(one, "a.txt", "work");
            const t = makeIo(fx.root, { answer: false });
            expect(await main(["delete", "1", "--branch", "--force"], t.io)).toBe(1);
            expect(t.err()).toContain("1 commit is not on any remote and is lost with the branch.");
            expect(t.err()).not.toContain("The branch keeps");
        });

        it("refuses on Windows when the shell is in the slot", async () => {
            const one = await fx.addWorktree(1, "feat/a");
            const t = makeIo(one, { platform: "win32", answer: true });
            expect(await main(["delete", "1"], t.io)).toBe(1);
            expect(t.err()).toContain("wtp switch 0");
            expect(existsSync(one)).toBe(true);
        });

        it.runIf(process.platform !== "win32")("moves the shell to the root on POSIX when it is in the slot", async () => {
            const one = await fx.addWorktree(1, "feat/a");
            const t = makeIo(one, { answer: true });
            expect(await main(["delete", "1"], t.io)).toBe(0);
            expect(samePath(await t.cwdTarget(), fx.root)).toBe(true);
        });
    });
});
