import { describe, expect, it } from "vitest";
import { composeSpawn, pickShell } from "../../src/platform/script-shell.js";

const PS_CHECK = "if (-not $?) { exit $(if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }) }";

describe("pickShell", () => {
    it("uses cmd from wtp.cmd", () => {
        expect(pickShell({ WTP_SHELL: "cmd", ComSpec: "C:\\Windows\\system32\\cmd.exe" }, "win32"))
            .toEqual({ shell: { kind: "cmd", exe: "C:\\Windows\\system32\\cmd.exe" }, warning: null });
    });

    it("uses the PowerShell host path from wtp.ps1, spaces and all", () => {
        const exe = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
        expect(pickShell({ WTP_SHELL: exe }, "win32").shell).toEqual({ kind: "powershell", exe });
        expect(pickShell({ WTP_SHELL: "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" }, "win32").shell.kind).toBe("powershell");
        expect(pickShell({ WTP_SHELL: "/usr/local/bin/pwsh" }, "darwin").shell).toEqual({ kind: "powershell", exe: "/usr/local/bin/pwsh" });
    });

    it("uses the profile function's shell", () => {
        expect(pickShell({ WTP_SHELL: "zsh" }, "darwin").shell).toEqual({ kind: "posix", exe: "zsh" });
        expect(pickShell({ WTP_SHELL: "bash" }, "win32").shell).toEqual({ kind: "posix", exe: "bash" });
        expect(pickShell({ WTP_SHELL: "fish" }, "linux").shell).toEqual({ kind: "fish", exe: "fish" });
    });

    it("falls back to ComSpec on Windows and $SHELL elsewhere", () => {
        expect(pickShell({ ComSpec: "cmd.exe" }, "win32").shell).toEqual({ kind: "cmd", exe: "cmd.exe" });
        expect(pickShell({}, "win32").shell).toEqual({ kind: "cmd", exe: "cmd.exe" });
        expect(pickShell({ SHELL: "/usr/bin/fish" }, "linux").shell).toEqual({ kind: "fish", exe: "/usr/bin/fish" });
        expect(pickShell({ SHELL: "/bin/zsh" }, "darwin").shell).toEqual({ kind: "posix", exe: "/bin/zsh" });
        expect(pickShell({}, "linux")).toEqual({ shell: { kind: "posix", exe: "/bin/sh" }, warning: null });
    });

    it("warns about an unknown value and falls back", () => {
        const r = pickShell({ WTP_SHELL: "nu", SHELL: "/bin/bash" }, "linux");
        expect(r.shell).toEqual({ kind: "posix", exe: "/bin/bash" });
        expect(r.warning).toBe("unknown WTP_SHELL \"nu\", using /bin/bash");
    });
});

describe("composeSpawn", () => {
    const cmds = (...c: string[]) => ({ kind: "commands" as const, commands: c, cwd: "/s" });

    it("keeps quotes in a cmd line", () => {
        const s = composeSpawn(cmds("node -e \"process.exit(0)\"", "copy \"a b\" c"), { kind: "cmd", exe: "cmd.exe" }, null)!;
        expect(s).toEqual({
            file: "cmd.exe",
            args: ["/d", "/s", "/c", "\"node -e \"process.exit(0)\" && copy \"a b\" c\""],
            verbatim: true,
            display: "node -e \"process.exit(0)\" && copy \"a b\" c"
        });
    });

    it("builds the PowerShell chain", () => {
        const s = composeSpawn(cmds("a", "b"), { kind: "powershell", exe: "pwsh" }, null)!;
        expect(s.file).toBe("pwsh");
        expect(s.verbatim).toBe(false);
        expect(s.args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
        expect(s.args[3]!.split("\n")).toEqual(["a", PS_CHECK, "b", PS_CHECK, "exit [int]$LASTEXITCODE"]);
        expect(s.display).toBe("a && b");
    });

    it("joins with && for POSIX shells and fish", () => {
        expect(composeSpawn(cmds("a", "b"), { kind: "posix", exe: "/bin/sh" }, null))
            .toEqual({ file: "/bin/sh", args: ["-c", "a && b"], verbatim: false, display: "a && b" });
        expect(composeSpawn(cmds("a"), { kind: "fish", exe: "fish" }, null)!.args).toEqual(["-c", "a"]);
    });

    it("runs a script fallback through bash in any shell, or not at all", () => {
        const script = { kind: "script" as const, scriptPath: "/r/.superset/setup.sh", cwd: "/s" };
        expect(composeSpawn(script, { kind: "cmd", exe: "cmd.exe" }, "C:\\Git\\bin\\bash.exe"))
            .toEqual({ file: "C:\\Git\\bin\\bash.exe", args: ["/r/.superset/setup.sh"], verbatim: false, display: "bash /r/.superset/setup.sh" });
        expect(composeSpawn(script, { kind: "posix", exe: "sh" }, null)).toBeNull();
    });
});
