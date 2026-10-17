import { resolveContext } from "../../core/context.js";
import { diagnose, MIN_GIT } from "../../core/doctor.js";
import { repairPool } from "../../core/pool.js";
import { LAUNCHER_VERSION, launcherVersion, realFs, type FsDeps } from "../../platform/launchers.js";
import { findOnPath } from "../../platform/path-search.js";
import { PS51_NOTE, readPs51Policy } from "../../platform/powershell.js";
import { hasIntegration, profilePath, sessionShell } from "../../platform/shell-init.js";
import type { Io } from "../io.js";
import type { Args } from "../main.js";
import { FUNCTION_HINT } from "../move.js";

export interface DoctorDeps {
  fs: FsDeps;
  ps51Policy(): Promise<string | null>;
}

// Says which wtp this shell runs. In bash, zsh, and fish the profile function wins over any file on PATH.
async function checkWtp(io: Io, deps: DoctorDeps): Promise<void> {
    const shell = sessionShell(io.platform, io.env, io.home);
    if (shell && (await hasIntegration(shell, io))) {
        io.stdout.write(`wtp -> the wtp function in ${profilePath(shell, io)}\n`);
        return;
    }
    const wins = findOnPath("wtp", { platform: io.platform, env: io.env, isFile: deps.fs.isFile });
    if (!wins) {
        io.stderr.write("! wtp is not set up. Run \"worktree-pool setup\" once.\n");
        return;
    }
    io.stdout.write(`wtp -> ${wins}\n`);
    const version = launcherVersion(wins, deps.fs);
    if (version === null) io.stderr.write(`! ${wins} runs as wtp, but it is not a wtp launcher. Run "worktree-pool setup" to see why.\n`);
    else if (version < LAUNCHER_VERSION) io.stderr.write(`! The wtp launcher ${wins} is old. Run "worktree-pool setup" to replace it.\n`);
    else if (io.platform !== "win32") io.stderr.write(FUNCTION_HINT);
    else if ((await deps.ps51Policy()) === "Restricted") io.stderr.write(PS51_NOTE);
}

export async function doctorCommand(
    args: Args,
    io: Io,
    deps: DoctorDeps = { fs: realFs, ps51Policy: () => readPs51Policy() }
): Promise<number> {
    await checkWtp(io, deps);
    const ctx = await resolveContext(io.cwd, io.platform);
    const d = await diagnose(ctx);
    if (d.gitTooOld) io.stderr.write(`! git ${d.gitVersion} is older than ${MIN_GIT.join(".")}. Update git.\n`);
    if (d.problems.length === 0) {
        io.stdout.write("No problems found.\n");
        return d.gitTooOld ? 1 : 0;
    }

    for (const p of d.problems) io.stdout.write(`slot ${p.index}: ${p.problem} (${p.path})\n`);
    let failed = false;

    if (d.problems.some((p) => p.autoFix)) {
        const ok = args.values.yes || (await io.confirm("Repair the problems that wtp can fix?"));
        if (ok) {
            for (const fixed of await repairPool(ctx)) io.stdout.write(`fixed ${fixed}\n`);
        }
        else {
            io.stdout.write("Nothing changed.\n");
            failed = true;
        }
    }
    for (const p of d.problems.filter((x) => !x.autoFix)) {
        io.stdout.write(`slot ${p.index}: wtp does not touch this folder. Check what it holds, then delete it by hand.\n`);
        failed = true;
    }
    return failed ? 1 : 0;
}
