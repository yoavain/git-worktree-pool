import { execFile } from "node:child_process";
import type { Runner } from "./process-tree.js";

export const PS51_NOTE =
  "PowerShell 5.1 blocks scripts, so wtp does not run there. To allow it: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned\n";

const runCommand = (env?: NodeJS.ProcessEnv): Runner => (cmd, args) =>
    new Promise((resolve, reject) => {
        execFile(cmd, args, { windowsHide: true, encoding: "utf8", env }, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout);
        });
    });

// A parent started with -ExecutionPolicy passes it on through PSExecutionPolicyPreference. Drop it.
export async function readPs51Policy(run?: Runner): Promise<string | null> {
    const env = { ...process.env };
    delete env.PSExecutionPolicyPreference;
    try {
        const out = await (run ?? runCommand(env))("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-ExecutionPolicy"]);
        return out.trim() || null;
    }
    catch {
        return null;
    }
}

// One elevated cmd copies all files, so Windows shows one UAC prompt.
export function adminCopyArgs(files: string[], dir: string): string[] {
    const copies = files.map((f) => `copy /y "${f}" "${dir}"`).join(" && ");
    // A declined UAC prompt makes Start-Process fail; without -ErrorAction Stop the script would still exit 0.
    const command =
    `try { $p = Start-Process -FilePath cmd.exe -ArgumentList '/d /c ${copies.replace(/'/g, "''")}' ` +
    "-Verb RunAs -Wait -PassThru -WindowStyle Hidden -ErrorAction Stop; exit $p.ExitCode } catch { exit 1 }";
    return ["-NoProfile", "-NonInteractive", "-Command", command];
}

export async function adminCopy(files: string[], dir: string, run?: Runner): Promise<boolean> {
    try {
        await (run ?? runCommand())("powershell.exe", adminCopyArgs(files, dir));
        return true;
    }
    catch {
        return false;
    }
}
