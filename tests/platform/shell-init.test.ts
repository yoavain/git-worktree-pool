import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    hasIntegration, initScript, installIntegration, MARKER, parseShell, PROFILE_MARKER, profileLine, profilePath,
    removeIntegration, shellForSetup
} from "../../src/platform/shell-init.js";

describe("initScript", () => {
    it("wraps worktree-pool for bash and zsh", () => {
        for (const shell of ["bash", "zsh"] as const) {
            const s = initScript(shell);
            expect(s).toContain("wtp() {");
            expect(s).toContain("WTP_CWD_FILE=\"$f\" command worktree-pool \"$@\"");
            expect(s).toContain("cygpath -u");
            expect(s).toContain(`WTP_SHELL=${shell} WTP_CWD_FILE="$f" command worktree-pool "$@"`);
        }
    });

    it("defines a fish function", () => {
        expect(initScript("fish")).toContain("function wtp");
        expect(initScript("fish")).toContain("WTP_SHELL=fish WTP_CWD_FILE=$f command worktree-pool $argv");
    });
});

describe("parseShell", () => {
    it("sends PowerShell users to setup", () => {
        expect(() => parseShell("pwsh")).toThrow(/needs no profile line.*worktree-pool setup/);
        expect(() => parseShell("powershell")).toThrow(/needs no profile line/);
    });

    it("rejects an unknown or missing shell", () => {
        expect(() => parseShell("tcsh")).toThrow(/bash, zsh, fish/);
        expect(() => parseShell(undefined)).toThrow(/Usage: wtp init <bash\|zsh\|fish>/);
    });
});

describe("profilePath and profileLine", () => {
    const home = path.resolve("/home/me");

    it("uses the standard profile files", () => {
        expect(profilePath("bash", { home, env: {} })).toBe(path.join(home, ".bashrc"));
        expect(profilePath("zsh", { home, env: {} })).toBe(path.join(home, ".zshrc"));
        expect(profilePath("zsh", { home, env: { ZDOTDIR: path.join(home, "z") } })).toBe(path.join(home, "z", ".zshrc"));
        expect(profilePath("fish", { home, env: {} })).toBe(path.join(home, ".config", "fish", "conf.d", "wtp.fish"));
    });

    it("calls worktree-pool, which exists before setup", () => {
        expect(profileLine("bash")).toBe("eval \"$(command worktree-pool init bash)\"");
        expect(profileLine("fish")).toBe("command worktree-pool init fish | source");
    });
});

describe("shellForSetup", () => {
    it("picks bash on Windows for Git Bash", () => {
        expect(shellForSetup("win32", { MSYSTEM: "MINGW64" }, "C:\\me", () => false)).toBe("bash");
        expect(shellForSetup("win32", {}, "C:\\me", (p) => p.endsWith(".bashrc"))).toBe("bash");
        expect(shellForSetup("win32", {}, "C:\\me", () => false)).toBeNull();
    });

    it("reads $SHELL elsewhere", () => {
        expect(shellForSetup("linux", { SHELL: "/usr/bin/zsh" }, "/home/me")).toBe("zsh");
        expect(shellForSetup("darwin", { SHELL: "/opt/homebrew/bin/fish" }, "/home/me")).toBe("fish");
        expect(shellForSetup("linux", { SHELL: "/bin/tcsh" }, "/home/me")).toBeNull();
    });
});

describe("install, has, and remove", () => {
    let home: string;
    beforeEach(async () => {
        home = await mkdtemp(path.join(os.tmpdir(), "wtp-home-"));
    });
    afterEach(async () => {
        await rm(home, { recursive: true, force: true });
    });

    const deps = (answer: boolean) => ({ home, env: {}, confirm: async () => answer, log: () => {} });

    it("appends the marker and the line once, then removes them", async () => {
        const rc = path.join(home, ".bashrc");
        await writeFile(rc, "export A=1");
        expect(await installIntegration("bash", deps(true))).toBe("installed");
        expect(await installIntegration("bash", deps(true))).toBe("already");
        expect(await readFile(rc, "utf8")).toBe(`export A=1\n\n${PROFILE_MARKER}\n${profileLine("bash")}\n`);
        expect(PROFILE_MARKER).toBe(`${MARKER} (wtp-profile 1)`);
        expect(await hasIntegration("bash", { home, env: {} })).toBe(true);
        expect(await removeIntegration("bash", { home, env: {} })).toBe(rc);
        expect(await readFile(rc, "utf8")).toBe("export A=1\n");
        expect(await hasIntegration("bash", { home, env: {} })).toBe(false);
        expect(await removeIntegration("bash", { home, env: {} })).toBeNull();
    });

    it("still knows the unnumbered marker that version 0.1.0 wrote", async () => {
        const rc = path.join(home, ".bashrc");
        await writeFile(rc, `export A=1\n\n${MARKER}\n${profileLine("bash")}\n`);
        expect(await hasIntegration("bash", { home, env: {} })).toBe(true);
        expect(await installIntegration("bash", deps(true))).toBe("already");
        await removeIntegration("bash", { home, env: {} });
        expect(await readFile(rc, "utf8")).toBe("export A=1\n");
    });

    it("also removes a phase 1 line that called wtp", async () => {
        const rc = path.join(home, ".zshrc");
        await writeFile(rc, `${MARKER}\neval "$(command wtp init zsh)"\nexport B=2\n`);
        await removeIntegration("zsh", { home, env: {} });
        expect(await readFile(rc, "utf8")).toBe("export B=2\n");
    });

    it("changes nothing when the user says no", async () => {
        expect(await installIntegration("bash", deps(false))).toBe("declined");
        expect(existsSync(path.join(home, ".bashrc"))).toBe(false);
    });

    it("creates the fish conf.d file and deletes it on remove", async () => {
        expect(await installIntegration("fish", deps(true))).toBe("installed");
        const file = path.join(home, ".config", "fish", "conf.d", "wtp.fish");
        expect(await readFile(file, "utf8")).toContain("worktree-pool init fish | source");
        await removeIntegration("fish", { home, env: {} });
        expect(existsSync(file)).toBe(false);
    });
});
