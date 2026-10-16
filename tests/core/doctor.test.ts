import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { diagnose, parseGitVersion } from "../../src/core/doctor.js";
import { resolveContext } from "../../src/core/context.js";
import { markerPath, slotPath } from "../../src/core/naming.js";
import { makeIo } from "../helpers/io.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

describe("parseGitVersion", () => {
    it("reads plain and Windows version strings", () => {
        expect(parseGitVersion("git version 2.45.1")).toEqual([2, 45, 1]);
        expect(parseGitVersion("git version 2.47.0.windows.2\n")).toEqual([2, 47, 0]);
        expect(parseGitVersion("nonsense")).toBeNull();
    });
});

describe("doctor", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    it("finds no problems in a clean pool", async () => {
        await fx.addWorktree(1, "a");
        const d = await diagnose(await resolveContext(fx.root));
        expect(d.problems).toEqual([]);
        expect(d.gitTooOld).toBe(false);
        const t = makeIo(fx.root);
        expect(await main(["doctor"], t.io)).toBe(0);
        expect(t.out()).toContain("No problems found.");
    });

    it("repairs a missing folder and an orphan marker after a yes", async () => {
        const two = await fx.addWorktree(2, "b");
        await rm(two, { recursive: true, force: true });
        await writeFile(markerPath(fx.poolRoot, "my-repo", 5), "");
        const t = makeIo(fx.root, { answer: true });
        expect(await main(["doctor"], t.io)).toBe(0);
        expect(t.out()).toContain("slot 2: folder is missing");
        expect(t.out()).toContain("fixed slot 5");
        expect(existsSync(markerPath(fx.poolRoot, "my-repo", 5))).toBe(false);
    });

    it("changes nothing when the user says no", async () => {
        await mkdir(fx.poolRoot, { recursive: true });
        await writeFile(markerPath(fx.poolRoot, "my-repo", 5), "");
        const t = makeIo(fx.root, { answer: false });
        expect(await main(["doctor"], t.io)).toBe(1);
        expect(existsSync(markerPath(fx.poolRoot, "my-repo", 5))).toBe(true);
    });

    it("reports an unregistered folder and leaves it alone", async () => {
        const stray = slotPath(fx.poolRoot, "my-repo", 4);
        await mkdir(stray, { recursive: true });
        const t = makeIo(fx.root, { answer: true });
        expect(await main(["doctor", "--yes"], t.io)).toBe(1);
        expect(t.out()).toContain("delete it by hand");
        expect(existsSync(stray)).toBe(true);
    });
});
