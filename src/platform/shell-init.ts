import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { UserError } from "../core/errors.js";

export type Shell = "bash" | "zsh" | "fish";
export const SHELLS: Shell[] = ["bash", "zsh", "fish"];
export const MARKER = "# wtp shell integration";
export const POWERSHELL_NO_PROFILE = "PowerShell needs no profile line. Run \"worktree-pool setup\" once.";

const POSIX = `${MARKER}
wtp() {
  local f rc dir
  f="$(mktemp "\${TMPDIR:-/tmp}/wtp-cwd.XXXXXX")" || return
  WTP_CWD_FILE="$f" command worktree-pool "$@"
  rc=$?
  dir="$(cat -- "$f" 2>/dev/null)"
  rm -f -- "$f"
  if [ -n "$dir" ]; then
    if command -v cygpath >/dev/null 2>&1; then dir="$(cygpath -u -- "$dir")"; fi
    if [ "$dir" != "$PWD" ]; then cd -- "$dir" || return; fi
  fi
  return $rc
}
`;

const FISH = `${MARKER}
function wtp
    set -l f (mktemp)
    or return
    WTP_CWD_FILE=$f command worktree-pool $argv
    set -l rc $status
    set -l dir (cat $f 2>/dev/null)
    rm -f $f
    if test -n "$dir"; and test "$dir" != "$PWD"
        cd $dir
    end
    return $rc
end
`;

export function parseShell(value: string | undefined): Shell {
    if (value === "pwsh" || value === "powershell") throw new UserError(POWERSHELL_NO_PROFILE);
    if (value === undefined) throw new UserError(`Usage: wtp init <${SHELLS.join("|")}>`);
    if (!(SHELLS as string[]).includes(value)) throw new UserError(`Unknown shell "${value}". Use one of: ${SHELLS.join(", ")}.`);
    return value as Shell;
}

export function initScript(shell: Shell): string {
    return shell === "fish" ? FISH : POSIX;
}

export function profileLine(shell: Shell): string {
    return shell === "fish" ? "command worktree-pool init fish | source" : `eval "$(command worktree-pool init ${shell})"`;
}

export interface ProfileDeps {
  home: string;
  env: NodeJS.ProcessEnv;
}

export function profilePath(shell: Shell, deps: ProfileDeps): string {
    switch (shell) {
        case "bash":
            return path.join(deps.home, ".bashrc");
        case "zsh":
            return path.join(deps.env.ZDOTDIR || deps.home, ".zshrc");
        case "fish":
            return path.join(deps.env.XDG_CONFIG_HOME || path.join(deps.home, ".config"), "fish", "conf.d", "wtp.fish");
    }
}

export async function installIntegration(
    shell: Shell,
    deps: ProfileDeps & { confirm(q: string): Promise<boolean>; log(s: string): void }
): Promise<"installed" | "already" | "declined"> {
    const file = profilePath(shell, deps);
    const current = existsSync(file) ? await readFile(file, "utf8") : "";
    if (current.includes(MARKER)) return "already";
    const line = profileLine(shell);
    deps.log(`wtp adds these lines to ${file}:\n\n  ${MARKER}\n  ${line}\n\n`);
    if (!(await deps.confirm("Add them?"))) return "declined";
    await mkdir(path.dirname(file), { recursive: true });
    const sep = current === "" || current.endsWith("\n") ? "" : "\n";
    await appendFile(file, `${sep}${current === "" ? "" : "\n"}${MARKER}\n${line}\n`);
    return "installed";
}

export async function hasIntegration(shell: Shell, deps: ProfileDeps): Promise<boolean> {
    const file = profilePath(shell, deps);
    return existsSync(file) && (await readFile(file, "utf8")).includes(MARKER);
}

// Removes the marker line, the profile line under it (also a phase 1 "wtp init" line), and the blank line before.
export async function removeIntegration(shell: Shell, deps: ProfileDeps): Promise<string | null> {
    const file = profilePath(shell, deps);
    if (!existsSync(file)) return null;
    const lines = (await readFile(file, "utf8")).split("\n");
    const i = lines.findIndex((l) => l.trimEnd() === MARKER);
    if (i === -1) return null;
    let start = i;
    const end = /\binit (bash|zsh|fish)\b/.test(lines[i + 1] ?? "") ? i + 2 : i + 1;
    if (start > 0 && (lines[start - 1] ?? "").trim() === "") start -= 1;
    lines.splice(start, end - start);
    const rest = lines.join("\n");
    if (shell === "fish" && rest.trim() === "") await rm(file, { force: true });
    else await writeFile(file, rest);
    return file;
}

// The shell whose profile setup adds the function to. On Windows only Git Bash needs it.
export function shellForSetup(
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv,
    home: string,
    exists: (p: string) => boolean = existsSync
): Shell | null {
    if (platform === "win32") return env.MSYSTEM || exists(path.join(home, ".bashrc")) ? "bash" : null;
    const name = path.basename(env.SHELL ?? "");
    return (SHELLS as string[]).includes(name) ? (name as Shell) : null;
}
