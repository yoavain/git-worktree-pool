import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSpawn, TAIL_CHARS, type ScriptRunOptions } from "../../src/platform/script-run.js";
import { composeSpawn, pickShell, type ScriptShell } from "../../src/platform/script-shell.js";
import { findGitBash } from "../helpers/git-bash.js";

const run = promisify(execFile);
const win = process.platform === "win32";

async function available(cmd: string, args: string[]): Promise<boolean> {
    try {
        await run(cmd, args, { windowsHide: true });
        return true;
    }
    catch {
        return false;
    }
}

const env: NodeJS.ProcessEnv = { ...process.env };
delete env.WTP_SHELL;
delete env.WTP_CWD_FILE;

// Vitest collects suites synchronously, so probe the shells with top-level await.
const psProbe = ["-NoProfile", "-NonInteractive", "-Command", "exit 0"];
const bash = await findGitBash();
const defaultShell = pickShell(env, process.platform).shell;
const shells: { label: string; shell: ScriptShell; ok: boolean }[] = [
    { label: "default shell", shell: defaultShell, ok: true },
    { label: "cmd", shell: { kind: "cmd", exe: env.ComSpec || "cmd.exe" }, ok: win },
    { label: "Windows PowerShell", shell: { kind: "powershell", exe: "powershell.exe" }, ok: win && (await available("powershell.exe", psProbe)) },
    { label: "pwsh", shell: { kind: "powershell", exe: "pwsh" }, ok: win && (await available("pwsh", psProbe)) },
    { label: "bash", shell: { kind: "posix", exe: bash ?? "bash" }, ok: bash !== null && (await available(bash, ["--version"])) }
];

let tmp: string;
let dir: string;

beforeEach(() => {
    // .native expands 8.3 names (CI's TEMP is C:\Users\RUNNER~1\...); shells report the long form.
    tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "wtp-run-")));
    dir = path.join(tmp, "slot");
    mkdirSync(path.join(dir, "sub"), { recursive: true });
    // Node helpers as files, so the entries need no shell-specific quoting.
    writeFileSync(path.join(dir, "big.cjs"), "for (let i = 0; i < 20000; i++) console.log('line ' + i);\n");
    writeFileSync(path.join(dir, "sleep.cjs"), "setTimeout(() => {}, 30000);\n");
    writeFileSync(path.join(dir, "grand.cjs"), [
        "const { spawn } = require('child_process');",
        "const c = spawn(process.execPath, ['-e', \"require('fs').writeFileSync('pid.txt', String(process.pid)); setTimeout(() => {}, 30000)\"], { stdio: 'ignore' });",
        "setTimeout(() => {}, 30000);",
        ""
    ].join("\n"));
});

// Async rm: Node 22's rmSync throws EBUSY at once on a non-empty folder, ignoring maxRetries.
afterEach(async () => {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function runIn(shell: ScriptShell, commands: string[], extra: Partial<ScriptRunOptions> = {}) {
    const spec = composeSpawn({ kind: "commands", commands, cwd: dir }, shell, null)!;
    return runSpawn(spec, { cwd: dir, env, output: "capture", ...extra });
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}

async function waitFor(check: () => boolean, ms = 10_000): Promise<void> {
    const end = Date.now() + ms;
    while (!check()) {
        if (Date.now() > end) throw new Error("timed out waiting");
        await new Promise((r) => setTimeout(r, 50));
    }
}

for (const { label, shell, ok } of shells) {
    describe.runIf(ok)(label, () => {
        it("stops the chain at the first failure and passes its exit code", async () => {
            const r = await runIn(shell, ["node -e \"process.exit(3)\"", "node -e \"require('fs').writeFileSync('after.txt', 'x')\""]);
            expect(r.code).toBe(3);
            expect(existsSync(path.join(dir, "after.txt"))).toBe(false);
        });

        it("keeps state between entries", async () => {
            const r = await runIn(shell, ["cd sub", "node -e \"console.log(process.cwd())\""]);
            expect(r.code).toBe(0);
            expect(r.tail).toContain(path.join(dir, "sub"));
        });

        it("runs quoted arguments with spaces", async () => {
            const r = await runIn(shell, ["node -e \"require('fs').writeFileSync('a b.txt', 'ok')\""]);
            expect(r.code).toBe(0);
            expect(readFileSync(path.join(dir, "a b.txt"), "utf8")).toBe("ok");
        });

        it("returns 0 when every entry passes", async () => {
            const r = await runIn(shell, ["node -e \"console.log('one')\"", "node -e \"console.log('two')\""]);
            expect(r).toMatchObject({ code: 0, timedOut: false, interrupted: false });
            expect(r.tail).toMatch(/one[\s\S]*two/);
        });
    });
}

describe("runSpawn", () => {
    it("drains a large output and keeps the tail", async () => {
        const r = await runIn(defaultShell, ["node big.cjs"]);
        expect(r.code).toBe(0);
        expect(r.tail.length).toBeLessThanOrEqual(TAIL_CHARS);
        expect(r.tail.trimEnd().endsWith("line 19999")).toBe(true);
    });

    it("times out", async () => {
        const r = await runIn(defaultShell, ["node sleep.cjs"], { timeoutMs: 300 });
        expect(r).toMatchObject({ timedOut: true, interrupted: false });
        expect(r.tail).toContain("timed out");
    });

    it("abort stops grandchildren", async () => {
        const ac = new AbortController();
        const p = runIn(defaultShell, ["node grand.cjs"], { signal: ac.signal });
        await waitFor(() => existsSync(path.join(dir, "pid.txt")) && readFileSync(path.join(dir, "pid.txt"), "utf8") !== "");
        ac.abort();
        expect((await p).interrupted).toBe(true);
        const pid = Number(readFileSync(path.join(dir, "pid.txt"), "utf8"));
        await waitFor(() => !alive(pid));
    });

    it("ends when the shell exits, even if a background process keeps the pipes open", async () => {
        // The background node writes its pid, then sleeps 30 s with the captured pipes inherited.
        const background = win ? "start /b node grand-bg.cjs" : "node grand-bg.cjs &";
        writeFileSync(path.join(dir, "grand-bg.cjs"), "require('fs').writeFileSync('pid.txt', String(process.pid)); setTimeout(() => {}, 30000);\n");
        const started = Date.now();
        const r = await runIn(defaultShell, [background]);
        expect(r.code).toBe(0);
        expect(Date.now() - started).toBeLessThan(10_000);
        await waitFor(() => existsSync(path.join(dir, "pid.txt")) && readFileSync(path.join(dir, "pid.txt"), "utf8") !== "");
        const pid = Number(readFileSync(path.join(dir, "pid.txt"), "utf8"));
        try {
            process.kill(pid);
        }
        catch {
            // Already gone.
        }
        // Wait for the exit: on Windows its cwd keeps the folder locked and afterEach's rmSync fails with EBUSY.
        await waitFor(() => !alive(pid));
    }, 20_000);

    it("counts a shell that died from Ctrl+C as interrupted", async () => {
        const r = await runIn(defaultShell, ["node -e \"process.exit(130)\""]);
        expect(r).toMatchObject({ code: 130, interrupted: true });
    });

    it("reports a missing program instead of throwing", async () => {
        const r = await runSpawn({ file: "no-such-shell-xyz", args: [], verbatim: false, display: "" }, { cwd: dir, env, output: "capture" });
        expect(r.code).toBeNull();
        expect(r.tail).not.toBe("");
    });
});
