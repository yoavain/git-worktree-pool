import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { samePath } from "../../src/core/naming.js";
import { findGitBash } from "../../src/platform/git-bash.js";
import { initScript } from "../../src/platform/shell-init.js";

const run = promisify(execFile);

async function available(cmd: string, args: string[]): Promise<boolean> {
    try {
        await run(cmd, args, { windowsHide: true });
        return true;
    }
    catch {
        return false;
    }
}

// Vitest collects suites synchronously, so probe the shell with top-level await.
const bash = await findGitBash();
const bashOk = bash !== null && (await available(bash, ["--version"]));

let tmp: string;
let bin: string;
let target: string;

beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), "wtp-shell-")));
    bin = path.join(tmp, "bin");
    target = path.join(tmp, "dir with space ü", "my-repo-wt-1");
    await mkdir(bin);
    await mkdir(target, { recursive: true });
    const sh = "#!/bin/sh\n[ -n \"$FAKE_TARGET\" ] && printf '%s' \"$FAKE_TARGET\" > \"$WTP_CWD_FILE\"\nexit \"${FAKE_EXIT:-0}\"\n";
    await writeFile(path.join(bin, "worktree-pool"), sh);
    await chmod(path.join(bin, "worktree-pool"), 0o755);
});

afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
});

describe("bash function", () => {
    it.runIf(bashOk)("changes the folder and keeps the exit code", async () => {
        const init = path.join(tmp, "init.sh");
        await writeFile(init, initScript("bash"));
        const script = [
            "to_unix() { command -v cygpath >/dev/null 2>&1 && cygpath -u \"$1\" || printf \"%s\" \"$1\"; }",
            "PATH=\"$(to_unix \"$1\"):$PATH\"",
            ". \"$(to_unix \"$2\")\"",
            "wtp; echo \"rc=$?\"",
            "pwd -W 2>/dev/null || pwd",
            "FAKE_TARGET= FAKE_EXIT=3 wtp; echo \"rc=$?\""
        ].join("\n");
        const { stdout } = await run(bash!, ["--noprofile", "--norc", "-c", script, "_", bin, init], {
            env: { ...process.env, FAKE_TARGET: target, FAKE_EXIT: "0" },
            windowsHide: true
        });
        const lines = stdout.trim().split(/\r?\n/);
        expect(lines[0]).toBe("rc=0");
        expect(samePath(lines[1]!, target)).toBe(true);
        expect(lines[2]).toBe("rc=3");
    });
});
