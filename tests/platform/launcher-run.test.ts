import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { samePath } from "../../src/core/naming.js";
import { findGitBash } from "../helpers/git-bash.js";

const run = promisify(execFile);
const win = process.platform === "win32";
const LAUNCHERS = fileURLToPath(new URL("../../launchers/", import.meta.url));
const NAMES = ["wtp.cmd", "wtp.ps1", "wtp"];

async function available(cmd: string, args: string[]): Promise<boolean> {
    try {
        await run(cmd, args, { windowsHide: true });
        return true;
    }
    catch {
        return false;
    }
}

interface Result { stdout: string; stderr: string; code: number }
async function attempt(cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd: string }): Promise<Result> {
    try {
        const r = await run(cmd, args, { ...opts, windowsHide: true });
        return { stdout: r.stdout, stderr: r.stderr, code: 0 };
    }
    catch (e) {
        const x = e as { stdout?: string; stderr?: string; code?: number };
        return { stdout: x.stdout ?? "", stderr: x.stderr ?? "", code: x.code ?? -1 };
    }
}

// Vitest collects suites synchronously, so probe the shells with top-level await.
const bash = await findGitBash();
const bashOk = bash !== null && (await available(bash, ["--version"]));
// The launchers are Windows-only, so off Windows the wtp.ps1 tests are skipped.
const psProbe = ["-NoProfile", "-NonInteractive", "-Command", "exit 0"];
const pwshOk = win && (await available("pwsh", psProbe));
const winPsOk = win && (await available("powershell.exe", psProbe));
const pwshModulePath = pwshOk
    ? await run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::Out.Write($env:PSModulePath)"], { windowsHide: true })
        .then((r) => r.stdout, () => null)
    : null;

// Each test sets PATH itself. On Windows the key can be "Path", so drop every spelling.
const baseEnv: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH"));
const originalPath = process.env.PATH ?? "";

let tmp: string;
let launcherDir: string;
let binDir: string;
let target: string;
let umlautTarget: string;

beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), "wtp-launch-")));
    // Spaces and parentheses, like a real install folder.
    launcherDir = path.join(tmp, "Program Files (x86)", "wtp");
    binDir = path.join(tmp, "bin");
    target = path.join(tmp, "slot");
    umlautTarget = path.join(tmp, "dir \u00fc", "slot");
    for (const d of [launcherDir, binDir, target, umlautTarget]) await mkdir(d, { recursive: true });
    for (const f of NAMES) await copyFile(path.join(LAUNCHERS, f), path.join(launcherDir, f));
    await chmod(path.join(launcherDir, "wtp"), 0o755);
    // The fake worktree-pool writes FAKE_TARGET to WTP_CWD_FILE, records WTP_VIA, and exits FAKE_EXIT.
    const sh = [
        "#!/bin/sh",
        "[ -n \"$FAKE_TARGET\" ] && printf '%s' \"$FAKE_TARGET\" > \"$WTP_CWD_FILE\"",
        "[ -n \"$FAKE_VIA_FILE\" ] && printf '%s' \"$WTP_VIA\" > \"$FAKE_VIA_FILE\"",
        "exit \"${FAKE_EXIT:-0}\"",
        ""
    ].join("\n");
    await writeFile(path.join(binDir, "worktree-pool"), sh);
    await chmod(path.join(binDir, "worktree-pool"), 0o755);
    if (win) {
    // cmd's own echo can't write UTF-8 reliably, so the fake hands the write to node, like the real one.
        // FAKE_RAN_FILE records that the fake ran, and with which WTP_CWD_FILE, for failure messages.
        const cmd = "@echo off\r\n"
            + "if not \"%FAKE_RAN_FILE%\"==\"\" node -e \"require('fs').writeFileSync(process.env.FAKE_RAN_FILE, 'cwd file: ' + (process.env.WTP_CWD_FILE || '(unset)'))\"\r\n"
            + "if not \"%FAKE_TARGET%\"==\"\" node -e \"require('fs').writeFileSync(process.env.WTP_CWD_FILE, process.env.FAKE_TARGET)\"\r\n"
            + "exit /b %FAKE_EXIT%\r\n";
        await writeFile(path.join(binDir, "worktree-pool.cmd"), cmd);
    }
});

afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
});

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    ...baseEnv,
    PATH: [launcherDir, binDir, originalPath].join(path.delimiter),
    FAKE_EXIT: "0",
    FAKE_TARGET: "",
    ...extra
});
const lastLine = (s: string) => s.trim().split(/\r?\n/).pop() ?? "";

describe("launcher files", () => {
    it("keep the line endings each shell needs", async () => {
        for (const f of ["wtp.cmd", "wtp.ps1"]) {
            const text = await readFile(path.join(LAUNCHERS, f), "latin1");
            expect(text.split("\n").slice(0, -1).every((l) => l.endsWith("\r"))).toBe(true);
        }
        expect(await readFile(path.join(LAUNCHERS, "wtp"), "latin1")).not.toContain("\r");
    });

    it("are ASCII and carry the marker", async () => {
        for (const f of NAMES) {
            const text = await readFile(path.join(LAUNCHERS, f), "latin1");
            expect([...text].every((c) => c.charCodeAt(0) < 128)).toBe(true);
            expect(text).toContain("wtp-launcher 2");
        }
    });
});

describe.runIf(win)("wtp.cmd", () => {
    const cmd = (line: string, e: NodeJS.ProcessEnv) => attempt("cmd.exe", ["/d", "/v:on", "/c", line], { env: e, cwd: tmp });

    it("moves cmd to the folder that worktree-pool picks", async () => {
        const r = await cmd("wtp & node -p process.cwd()", env({ FAKE_TARGET: target }));
        expect(samePath(lastLine(r.stdout), target)).toBe(true);
    });

    it("handles a non-ASCII folder", async () => {
        const r = await cmd("wtp & node -p process.cwd()", env({ FAKE_TARGET: umlautTarget }));
        expect(samePath(lastLine(r.stdout), umlautTarget)).toBe(true);
    });

    it("keeps the exit code and stays put without a folder", async () => {
        const r = await cmd("wtp & echo rc=!errorlevel! & node -p process.cwd()", env({ FAKE_EXIT: "3" }));
        const lines = r.stdout.trim().split(/\r?\n/);
        expect(lines.at(-2)?.trim()).toBe("rc=3");
        expect(samePath(lines.at(-1)!, tmp)).toBe(true);
    });

    it("leaves a WTP_CWD_FILE that the caller set alone", async () => {
        const preset = path.join(tmp, "preset.txt");
        await writeFile(preset, "");
        const r = await cmd("wtp & node -p process.cwd()", env({ FAKE_TARGET: target, WTP_CWD_FILE: preset }));
        expect(samePath(lastLine(r.stdout), tmp)).toBe(true);
        expect(await readFile(preset, "utf8")).toBe(target);
    });

    it("explains a missing worktree-pool", async () => {
        const system32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
        const r = await cmd("wtp & echo rc=!errorlevel!", { ...baseEnv, PATH: [launcherDir, system32].join(";") });
        expect(r.stdout).toContain("rc=9009");
        expect(r.stderr).toContain("worktree-pool is not installed");
        expect(r.stderr).toContain("Program Files (x86)");
    });
});

describe("wtp.ps1", () => {
    const ps = (exe: string, command: string, e: NodeJS.ProcessEnv) =>
        attempt(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { env: e, cwd: tmp });
    const read = (f: string) => readFile(f, "utf8").catch(() => "(no file)");

    // The shell writes its folder to a UTF-8 file, so the check does not depend on the console code page.
    async function movesTo(exe: string, tag: string, extra: NodeJS.ProcessEnv = {}) {
        const where = path.join(tmp, `where-${tag}.txt`);
        const ran = path.join(tmp, `ran-${tag}.txt`);
        const r = await ps(exe, ["wtp", "\"rc=$LASTEXITCODE\"", `[IO.File]::WriteAllText('${where}', (Get-Location).Path)`].join("; "),
            env({ FAKE_TARGET: umlautTarget, FAKE_RAN_FILE: ran, ...extra }));
        const landed = await read(where);
        const why = `landed in ${landed}; fake: ${await read(ran)}; stderr: ${r.stderr.trim() || "(empty)"}`;
        expect(lastLine(r.stdout), why).toBe("rc=0");
        expect(samePath(landed, umlautTarget), why).toBe(true);
    }

    for (const [exe, ok] of [["pwsh", pwshOk], ["powershell.exe", winPsOk]] as const) {
        it.runIf(ok)(`moves ${exe} to the folder that worktree-pool picks`, () => movesTo(exe, exe));

        it.runIf(ok)(`keeps the exit code in ${exe}`, async () => {
            const r = await ps(exe, "wtp; \"rc=$LASTEXITCODE\"", env({ FAKE_EXIT: "3" }));
            expect(lastLine(r.stdout)).toBe("rc=3");
        });
    }

    // GitHub runs Windows steps in pwsh, and a powershell.exe started from pwsh inherits pwsh's
    // PSModulePath. Windows PowerShell 5.1 then cannot load New-TemporaryFile.
    it.runIf(winPsOk && pwshModulePath !== null)("moves powershell.exe when it inherits the PSModulePath of pwsh", () =>
        movesTo("powershell.exe", "powershell-from-pwsh", { PSModulePath: pwshModulePath! }));
});

describe("wtp (sh)", () => {
    const toUnix = "to_unix() { command -v cygpath >/dev/null 2>&1 && cygpath -u \"$1\" || printf \"%s\" \"$1\"; }";

    it.runIf(bashOk)("runs worktree-pool with WTP_VIA=sh and keeps the exit code, but cannot move the shell", async () => {
        const via = path.join(tmp, "via.txt");
        const script = [toUnix, "PATH=\"$(to_unix \"$1\"):$(to_unix \"$2\"):$PATH\"", "cd \"$(to_unix \"$3\")\"", "wtp; echo \"rc=$?\"", "pwd -W 2>/dev/null || pwd"].join("\n");
        const { stdout } = await run(bash!, ["--noprofile", "--norc", "-c", script, "_", launcherDir, binDir, tmp], {
            env: { ...process.env, FAKE_EXIT: "4", FAKE_TARGET: "", FAKE_VIA_FILE: via }, windowsHide: true
        });
        const lines = stdout.trim().split(/\r?\n/);
        expect(lines[0]).toBe("rc=4");
        expect(samePath(lines[1]!, tmp)).toBe(true);
        expect(await readFile(via, "utf8")).toBe("sh");
    });

    it.runIf(bashOk)("explains a missing worktree-pool", async () => {
        const script = [toUnix, "PATH=\"$(to_unix \"$1\"):/usr/bin:/bin\"", "wtp; echo \"rc=$?\""].join("\n");
        const r = await attempt(bash!, ["--noprofile", "--norc", "-c", script, "_", launcherDir], { env: { ...process.env }, cwd: tmp });
        expect(lastLine(r.stdout)).toBe("rc=127");
        expect(r.stderr).toContain("worktree-pool is not installed");
    });
});
