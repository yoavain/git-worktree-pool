import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterTeardown, cliTeardown, failureText, runLifecycle, type LifecycleDeps, type LifecycleFailure, type LifecycleTarget } from "../../src/cli/lifecycle.js";
import { UserError } from "../../src/core/errors.js";
import { makeIo } from "../helpers/io.js";
import { findGitBash } from "../helpers/git-bash.js";

const env: NodeJS.ProcessEnv = { ...process.env };
delete env.WTP_SHELL;
delete env.WTP_CWD_FILE;

const bash = await findGitBash();

const WRITE_ENV = "node -e \"require('fs').writeFileSync('env.json', JSON.stringify(process.env))\"";

let tmp: string;
let root: string;
let slot: string;
let home: string;
let target: LifecycleTarget;

beforeEach(() => {
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wtp-lc-")));
    root = path.join(tmp, "repo");
    slot = path.join(tmp, "repo-wt-pool", "repo-wt-1");
    home = path.join(tmp, "home");
    for (const d of [root, slot, home]) mkdirSync(d, { recursive: true });
    target = { root, index: 1, path: slot, branch: "feat/x" };
});

afterEach(() => {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function config(dir: string, json: unknown) {
    mkdirSync(path.join(dir, ".superset"), { recursive: true });
    writeFileSync(path.join(dir, ".superset", "config.json"), JSON.stringify(json));
}

const deps = (over: Partial<LifecycleDeps> = {}): LifecycleDeps => ({
    env, platform: process.platform, home, output: "capture", warn: vi.fn(), onStart: vi.fn(), ...over
});

describe("runLifecycle", () => {
    it("skips when nothing is configured", async () => {
        const d = deps();
        expect(await runLifecycle("setup", target, d)).toEqual({ status: "skipped" });
        expect(d.onStart).not.toHaveBeenCalled();
    });

    it("sets the Superset variables and WTP_SLOT, and hides WTP_CWD_FILE", async () => {
        config(root, { setup: [WRITE_ENV] });
        const r = await runLifecycle("setup", target, deps({ env: { ...env, WTP_CWD_FILE: path.join(tmp, "cwd") } }));
        expect(r).toEqual({ status: "ok", display: WRITE_ENV });
        const seen = JSON.parse(readFileSync(path.join(slot, "env.json"), "utf8")) as NodeJS.ProcessEnv;
        expect(seen).toMatchObject({ SUPERSET_ROOT_PATH: root, SUPERSET_WORKSPACE_NAME: "feat/x", SUPERSET_WORKSPACE_PATH: slot, WTP_SLOT: "1" });
        expect(seen.WTP_CWD_FILE).toBeUndefined();
    });

    it("reports a failure with its exit code", async () => {
        config(root, { setup: ["node -e \"process.exit(5)\""] });
        const r = await runLifecycle("setup", target, deps());
        expect(r).toMatchObject({ status: "failed", code: 5, timedOut: false, interrupted: false });
        expect(failureText("setup", r as LifecycleFailure)).toBe("setup failed with exit code 5");
    });

    it("passes resolver warnings on and calls onStart once", async () => {
        mkdirSync(path.join(slot, ".superset"), { recursive: true });
        writeFileSync(path.join(slot, ".superset", "config.json"), "{ nope");
        config(root, { teardown: ["node -e \"0\""] });
        const d = deps();
        expect((await runLifecycle("teardown", target, d)).status).toBe("ok");
        expect(d.warn).toHaveBeenCalledWith(expect.stringContaining(path.join(slot, ".superset", "config.json")));
        expect(d.onStart).toHaveBeenCalledTimes(1);
        expect(d.onStart).toHaveBeenCalledWith("node -e \"0\"");
    });

    it("passes the WTP_SHELL warning on", async () => {
        config(root, { setup: ["node -e \"0\""] });
        const d = deps({ env: { ...env, WTP_SHELL: "nu" } });
        await runLifecycle("setup", target, d);
        expect(d.warn).toHaveBeenCalledWith(expect.stringContaining("unknown WTP_SHELL \"nu\""));
    });

    it.runIf(bash !== null)("runs a script fallback through bash", async () => {
        mkdirSync(path.join(root, ".superset"), { recursive: true });
        writeFileSync(path.join(root, ".superset", "setup.sh"), "echo \"$SUPERSET_WORKSPACE_NAME\" > from-sh.txt\n");
        const r = await runLifecycle("setup", target, deps());
        expect(r.status).toBe("ok");
        expect(readFileSync(path.join(slot, "from-sh.txt"), "utf8").trim()).toBe("feat/x");
    });
});

describe("cliTeardown", () => {
    const io = () => makeIo(slot, { env, home });

    it("tells a skipped teardown from one that ran", async () => {
        expect(await cliTeardown(root, target, io().io)).toBe("skipped");
        config(root, { teardown: ["node -e \"0\""] });
        expect(await cliTeardown(root, target, io().io)).toBe("ran");
    });

    it("counts a failed teardown as ran, and warns", async () => {
        config(root, { teardown: ["node -e \"process.exit(7)\""] });
        const t = io();
        expect(await cliTeardown(root, target, t.io)).toBe("ran");
        expect(t.err()).toContain("! teardown failed with exit code 7");
    });

    it("prints why a script could not start", async () => {
        config(root, { teardown: ["node -e \"0\""], cwd: "no-such-dir" });
        const t = io();
        expect(await cliTeardown(root, target, t.io)).toBe("ran");
        expect(t.err()).toContain(`cwd ${path.join(slot, "no-such-dir")} does not exist`);
    });
});

describe("afterTeardown", () => {
    const refuse = async () => {
        throw new UserError("Close it and run wtp delete 1 again.");
    };

    it("says teardown already ran only when it did", async () => {
        await expect(afterTeardown(false, refuse)).rejects.toThrow(/^Close it and run wtp delete 1 again\.$/);
        await expect(afterTeardown(true, refuse)).rejects.toThrow("Close it and run wtp delete 1 again. Its teardown already ran.");
    });
});

describe("failureText", () => {
    const f = (over: Partial<LifecycleFailure>): LifecycleFailure =>
        ({ status: "failed", display: "x", code: null, timedOut: false, interrupted: false, tail: "", ...over });

    it("names the cause", () => {
        expect(failureText("teardown", f({ timedOut: true }))).toBe("teardown timed out after 60 s");
        expect(failureText("setup", f({ interrupted: true }))).toBe("setup was interrupted");
        expect(failureText("setup", f({ code: 5 }))).toBe("setup failed with exit code 5");
        expect(failureText("setup", f({}))).toBe("setup failed");
    });
});
