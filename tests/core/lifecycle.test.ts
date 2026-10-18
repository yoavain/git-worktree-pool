import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveLifecycle, userOverridePath, type LifecycleKey, type Resolution } from "../../src/core/lifecycle.js";

let tmp: string;
let root: string;
let slot: string;
let home: string;

beforeEach(() => {
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wtp-life-")));
    root = path.join(tmp, "repo");
    slot = path.join(tmp, "pool", "repo-wt-1");
    home = path.join(tmp, "home");
    for (const d of [root, slot, home]) mkdirSync(d, { recursive: true });
});

afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
});

function writeText(dir: string, rel: string, text: string) {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
}

const write = (dir: string, rel: string, json: unknown) => writeText(dir, rel, JSON.stringify(json));
const resolve = (key: LifecycleKey) => resolveLifecycle(key, { root, slot, home, platform: process.platform });
const overrideRel = () => path.relative(home, userOverridePath(home, root, process.platform));

function commands(r: Resolution): string[] {
    if (r.script?.kind !== "commands") throw new Error(`expected commands, got ${JSON.stringify(r.script)}`);
    return r.script.commands;
}

describe("resolveLifecycle", () => {
    it("returns nothing when no file exists", async () => {
        expect(await resolve("setup")).toEqual({ script: null, warnings: [] });
    });

    it("reads the repo config, cwd defaults to the slot", async () => {
        write(root, ".superset/config.json", { setup: ["npm install"] });
        expect((await resolve("setup")).script).toEqual({ kind: "commands", commands: ["npm install"], cwd: slot });
    });

    it("lets the worktree beat the repo and the user override beat both, per key", async () => {
        write(root, ".superset/config.json", { setup: ["repo"], teardown: ["repo-down"] });
        write(slot, ".superset/config.json", { setup: ["wt"] });
        expect(commands(await resolve("setup"))).toEqual(["wt"]);
        expect(commands(await resolve("teardown"))).toEqual(["repo-down"]);
        write(home, overrideRel(), { setup: ["user"] });
        expect(commands(await resolve("setup"))).toEqual(["user"]);
    });

    it("merges cwd per key and resolves it against the slot", async () => {
        write(root, ".superset/config.json", { setup: ["x"], cwd: "apps/web" });
        expect((await resolve("setup")).script!.cwd).toBe(path.join(slot, "apps/web"));
        write(slot, ".superset/config.json", { cwd: "apps/api" });
        expect((await resolve("setup")).script!.cwd).toBe(path.join(slot, "apps/api"));
    });

    it("lets an empty array hide lower levels but still reach the script fallback", async () => {
        write(root, ".superset/config.json", { setup: ["repo"] });
        write(slot, ".superset/config.json", { setup: [] });
        expect((await resolve("setup")).script).toBeNull();
        writeText(root, ".superset/setup.sh", "echo hi\n");
        expect((await resolve("setup")).script).toEqual({ kind: "script", scriptPath: path.join(root, ".superset", "setup.sh"), cwd: slot });
    });

    it("drops blank entries", async () => {
        write(root, ".superset/config.json", { setup: ["  ", "npm ci"] });
        expect(commands(await resolve("setup"))).toEqual(["npm ci"]);
    });

    it("prefers the worktree script, then the repo script", async () => {
        writeText(root, ".superset/teardown.sh", "echo repo\n");
        writeText(slot, ".superset/teardown.sh", "echo wt\n");
        expect((await resolve("teardown")).script).toEqual({ kind: "script", scriptPath: path.join(slot, ".superset", "teardown.sh"), cwd: slot });
    });

    it("treats an invalid file as absent and warns with its path", async () => {
        writeText(slot, ".superset/config.json", "{ nope");
        write(root, ".superset/config.json", { setup: ["repo"] });
        const r = await resolve("setup");
        expect(commands(r)).toEqual(["repo"]);
        expect(r.warnings).toHaveLength(1);
        expect(r.warnings[0]).toContain(path.join(slot, ".superset", "config.json"));
    });

    it("treats a wrong-typed key or an empty cwd as making the whole file absent", async () => {
        write(slot, ".superset/config.json", { setup: "npm i" });
        write(root, ".superset/config.json", { setup: ["repo"], cwd: " " });
        const r = await resolve("setup");
        expect(r.script).toBeNull();
        expect(r.warnings).toHaveLength(2);
        expect(r.warnings.join("\n")).toContain("'setup' must be an array of strings");
        expect(r.warnings.join("\n")).toContain("'cwd' must be a non-empty string");
    });

    it("reads a file with a BOM", async () => {
        writeText(root, ".superset/config.json", "\uFEFF" + JSON.stringify({ setup: ["npm i"] }));
        expect(commands(await resolve("setup"))).toEqual(["npm i"]);
    });

    it("replaces the base with a plain local array", async () => {
        write(root, ".superset/config.json", { setup: ["team"] });
        write(root, ".superset/config.local.json", { setup: ["mine"] });
        expect(commands(await resolve("setup"))).toEqual(["mine"]);
    });

    it("wraps the base with before and after", async () => {
        write(root, ".superset/config.json", { setup: ["team"] });
        write(root, ".superset/config.local.json", { setup: { before: ["b"], after: ["a"] } });
        expect(commands(await resolve("setup"))).toEqual(["b", "team", "a"]);
        write(root, ".superset/config.local.json", { setup: { after: ["a"] } });
        expect(commands(await resolve("setup"))).toEqual(["team", "a"]);
    });

    it("picks the worktree local file as a whole over the repo's", async () => {
        write(root, ".superset/config.json", { setup: ["team"], teardown: ["down"] });
        write(root, ".superset/config.local.json", { teardown: ["repo-local"] });
        write(slot, ".superset/config.local.json", { setup: ["wt-local"] });
        expect(commands(await resolve("teardown"))).toEqual(["down"]);
        expect(commands(await resolve("setup"))).toEqual(["wt-local"]);
    });

    it("warns about an invalid local file and treats it as absent", async () => {
        write(root, ".superset/config.json", { setup: ["team"] });
        write(slot, ".superset/config.local.json", { setup: { before: "x" } });
        write(root, ".superset/config.local.json", { setup: ["repo-local"] });
        const r = await resolve("setup");
        expect(commands(r)).toEqual(["repo-local"]);
        expect(r.warnings[0]).toContain("'setup.before' must be an array of strings");
    });

    it("ignores a local file without a base, and over a script fallback", async () => {
        write(root, ".superset/config.local.json", { setup: ["mine"] });
        expect((await resolve("setup")).script).toBeNull();
        writeText(root, ".superset/setup.sh", "echo\n");
        expect((await resolve("setup")).script!.kind).toBe("script");
    });

    it("never lets the local file change cwd", async () => {
        write(root, ".superset/config.json", { setup: ["team"] });
        write(root, ".superset/config.local.json", { cwd: "elsewhere", setup: ["mine"] });
        expect((await resolve("setup")).script!.cwd).toBe(slot);
    });
});

describe("userOverridePath", () => {
    it("mirrors a POSIX path", () => {
        expect(userOverridePath("/home/me", "/Users/me/app", "linux")).toBe(path.posix.join("/home/me", ".superset/projects/Users/me/app/config.json"));
    });

    it("drops the drive colon on Windows", () => {
        expect(userOverridePath("C:\\Users\\me", "C:\\Dev\\app", "win32")).toBe("C:\\Users\\me\\.superset\\projects\\C\\Dev\\app\\config.json");
    });
});
