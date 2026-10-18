import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { markerPath, samePath, slotPath } from "../../src/core/naming.js";
import { makeIo } from "../helpers/io.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

// The CLI runs .superset setup and teardown around assign, free and delete. Each entry is a node
// command, so it runs the same in cmd, PowerShell and sh.

const testEnv: NodeJS.ProcessEnv = { ...process.env };
delete testEnv.WTP_SHELL;
delete testEnv.WTP_CWD_FILE;

const WRITE_ENV = "node -e \"require('fs').writeFileSync('env.json', JSON.stringify(process.env))\"";
// Writes the slot's current branch to <clone>/teardown.txt, so the test can read it after the slot is gone.
const WRITE_BRANCH_TO_ROOT = "node -e \"require('fs').writeFileSync(require('path').join(process.env.SUPERSET_ROOT_PATH, 'teardown.txt'), "
    + "require('child_process').execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }))\"";
const EXIT = (n: number) => `node -e "process.exit(${n})"`;

describe("lifecycle scripts in the CLI", () => {
    let fx: Fixture;
    let home: string;
    beforeEach(async () => {
        fx = await makeRepo("my-repo", { parentName: "dir with space ü" });
        home = path.join(fx.tmp, "home");
        mkdirSync(home);
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    const slot = (n: number) => slotPath(fx.poolRoot, "my-repo", n);
    const io = (opts: Parameters<typeof makeIo>[1] = {}) => makeIo(fx.root, { env: testEnv, home, ...opts });

    async function commitConfig(json: unknown) {
        mkdirSync(path.join(fx.root, ".superset"), { recursive: true });
        await fx.commitFile(fx.root, ".superset/config.json", JSON.stringify(json));
    }

    describe("assign", () => {
        it("runs setup in the slot", async () => {
            await commitConfig({ setup: [WRITE_ENV] });
            const t = io();
            expect(await main(["assign", "feat/x"], t.io)).toBe(0);
            expect(t.err()).toContain("setup: node -e");
            expect(existsSync(path.join(slot(1), "env.json"))).toBe(true);
        });

        it("sets the Superset variables", async () => {
            await commitConfig({ setup: [WRITE_ENV] });
            expect(await main(["assign", "feat/x"], io().io)).toBe(0);
            const seen = JSON.parse(readFileSync(path.join(slot(1), "env.json"), "utf8")) as NodeJS.ProcessEnv;
            expect(samePath(seen.SUPERSET_ROOT_PATH!, fx.root)).toBe(true);
            expect(samePath(seen.SUPERSET_WORKSPACE_PATH!, slot(1))).toBe(true);
            expect(seen.SUPERSET_WORKSPACE_NAME).toBe("feat/x");
            expect(seen.WTP_SLOT).toBe("1");
        });

        it("runs setup again on a reused free slot", async () => {
            await commitConfig({ setup: [WRITE_ENV] });
            expect(await main(["assign", "feat/x"], io().io)).toBe(0);
            expect(await main(["free", "1", "--yes", "--no-teardown"], io().io)).toBe(0);
            const t = io();
            expect(await main(["assign", "feat/y"], t.io)).toBe(0);
            expect(t.err()).toContain("-> slot 1 (free, reused)");
            const seen = JSON.parse(readFileSync(path.join(slot(1), "env.json"), "utf8")) as NodeJS.ProcessEnv;
            expect(seen.SUPERSET_WORKSPACE_NAME).toBe("feat/y");
        });

        it("still hands off the folder and exits 4 when setup fails", async () => {
            await commitConfig({ setup: [EXIT(5)] });
            const t = io();
            expect(await main(["assign", "feat/x"], t.io)).toBe(4);
            expect(t.err()).toContain("! setup failed with exit code 5");
            expect(samePath(t.copies[0]!, slot(1))).toBe(true);
            expect(samePath(await t.cwdTarget(), slot(1))).toBe(true);
        });

        it("skips setup with --no-setup", async () => {
            await commitConfig({ setup: [WRITE_ENV] });
            const t = io();
            expect(await main(["assign", "feat/x", "--no-setup"], t.io)).toBe(0);
            expect(t.err()).not.toContain("setup:");
            expect(existsSync(path.join(slot(1), "env.json"))).toBe(false);
        });

        it("warns about an invalid config and still assigns", async () => {
            mkdirSync(path.join(fx.root, ".superset"), { recursive: true });
            await fx.commitFile(fx.root, ".superset/config.json", "{ nope");
            const t = io();
            expect(await main(["assign", "feat/x"], t.io)).toBe(0);
            expect(t.err()).toContain("! ignored ");
        });
    });

    describe("free and delete", () => {
        const teardownTxt = () => path.join(fx.root, "teardown.txt");
        async function assigned(json: unknown) {
            await commitConfig(json);
            expect(await main(["assign", "feat/x", "--no-setup"], io().io)).toBe(0);
        }

        it("runs teardown before free, with the branch still checked out", async () => {
            await assigned({ teardown: [WRITE_BRANCH_TO_ROOT] });
            const t = io();
            expect(await main(["free", "1", "--yes"], t.io)).toBe(0);
            expect(t.err()).toContain("teardown: node -e");
            expect(readFileSync(teardownTxt(), "utf8").trim()).toBe("feat/x");
            expect(existsSync(markerPath(fx.poolRoot, "my-repo", 1))).toBe(true);
        });

        it("frees anyway when teardown fails, with a warning", async () => {
            await assigned({ teardown: [EXIT(7)] });
            const t = io();
            expect(await main(["free", "1", "--yes"], t.io)).toBe(0);
            expect(t.err()).toContain("! teardown failed with exit code 7");
            expect(existsSync(markerPath(fx.poolRoot, "my-repo", 1))).toBe(true);
        });

        it("runs teardown before delete, and deletes anyway when it fails", async () => {
            await assigned({ teardown: [WRITE_BRANCH_TO_ROOT, EXIT(7)] });
            const t = io();
            expect(await main(["delete", "1", "--yes"], t.io)).toBe(0);
            expect(readFileSync(teardownTxt(), "utf8").trim()).toBe("feat/x");
            expect(t.err()).toContain("! teardown failed with exit code 7");
            expect(existsSync(slot(1))).toBe(false);
        });

        it("runs no teardown for a free slot on delete", async () => {
            await assigned({ teardown: [WRITE_BRANCH_TO_ROOT] });
            expect(await main(["free", "1", "--yes", "--no-teardown"], io().io)).toBe(0);
            const t = io();
            expect(await main(["delete", "1", "--yes"], t.io)).toBe(0);
            expect(existsSync(teardownTxt())).toBe(false);
            expect(t.err()).not.toContain("teardown:");
        });

        it("refuses a locked slot before teardown runs", async () => {
            await assigned({ teardown: [WRITE_BRANCH_TO_ROOT] });
            await fx.git(fx.root, "worktree", "lock", slot(1));
            expect(await main(["free", "1", "--yes"], io().io)).toBe(1);
            expect(await main(["delete", "1", "--yes"], io().io)).toBe(1);
            expect(existsSync(teardownTxt())).toBe(false);
        });

        it("skips teardown with --no-teardown", async () => {
            await assigned({ teardown: [WRITE_BRANCH_TO_ROOT] });
            expect(await main(["free", "1", "--yes", "--no-teardown"], io().io)).toBe(0);
            expect(await main(["assign", "feat/y", "--no-setup"], io().io)).toBe(0);
            expect(await main(["delete", "1", "--yes", "--no-teardown"], io().io)).toBe(0);
            expect(existsSync(teardownTxt())).toBe(false);
        });
    });
});
