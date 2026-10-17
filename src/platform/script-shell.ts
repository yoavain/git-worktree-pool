import path from "node:path";
import type { ResolvedScript } from "../core/lifecycle.js";

// Lifecycle commands run in the shell that called wtp. The launchers and the profile function name it
// in WTP_SHELL: "cmd", a PowerShell host's path, "bash", "zsh" or "fish".

export type ShellKind = "cmd" | "powershell" | "posix" | "fish";

export interface ScriptShell {
  kind: ShellKind;
  exe: string;
}

export interface SpawnSpec {
  file: string;
  args: string[];
  // cmd parses its own command line, so Node must pass it unquoted.
  verbatim: boolean;
  // The line as the user wrote it, for progress and error messages.
  display: string;
}

function fallbackShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): ScriptShell {
    if (platform === "win32") return { kind: "cmd", exe: env.ComSpec || "cmd.exe" };
    const exe = env.SHELL || "/bin/sh";
    return { kind: path.posix.basename(exe) === "fish" ? "fish" : "posix", exe };
}

export function pickShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): { shell: ScriptShell; warning: string | null } {
    const value = env.WTP_SHELL;
    if (!value) return { shell: fallbackShell(env, platform), warning: null };
    if (value === "cmd") return { shell: { kind: "cmd", exe: env.ComSpec || "cmd.exe" }, warning: null };
    if (value === "bash" || value === "zsh") return { shell: { kind: "posix", exe: value }, warning: null };
    if (value === "fish") return { shell: { kind: "fish", exe: "fish" }, warning: null };
    const base = value.split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, "");
    if (base === "powershell" || base === "pwsh") return { shell: { kind: "powershell", exe: value }, warning: null };
    const shell = fallbackShell(env, platform);
    return { shell, warning: `unknown WTP_SHELL "${value}", using ${shell.exe}` };
}

// Windows PowerShell 5.1 has no &&. This chain stops at the first failure in 5.1 and in pwsh 7,
// and exits with the failing native command's exit code.
const PS_CHECK = "if (-not $?) { exit $(if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }) }";

function psChain(commands: string[]): string {
    return [...commands.flatMap((c) => [c, PS_CHECK]), "exit [int]$LASTEXITCODE"].join("\n");
}

// Superset joins the commands with " && " and runs them in one shell, so a cd or an export carries over.
export function composeSpawn(script: ResolvedScript, shell: ScriptShell, bashExe: string | null): SpawnSpec | null {
    if (script.kind === "script") {
        if (!bashExe) return null;
        return { file: bashExe, args: [script.scriptPath], verbatim: false, display: `bash ${script.scriptPath}` };
    }
    const line = script.commands.join(" && ");
    switch (shell.kind) {
        case "cmd":
            return { file: shell.exe, args: ["/d", "/s", "/c", `"${line}"`], verbatim: true, display: line };
        case "powershell":
            return { file: shell.exe, args: ["-NoProfile", "-NonInteractive", "-Command", psChain(script.commands)], verbatim: false, display: line };
        case "posix":
        case "fish":
            return { file: shell.exe, args: ["-c", line], verbatim: false, display: line };
    }
}
