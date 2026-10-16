import { resolveContext } from "../../core/context.js";
import { diagnose, MIN_GIT } from "../../core/doctor.js";
import { repairPool } from "../../core/pool.js";
import { LAUNCHER_VERSION, markerVersion, realFs, type FsDeps } from "../../platform/launchers.js";
import { findOnPath } from "../../platform/path-search.js";
import { PS51_NOTE, readPs51Policy } from "../../platform/powershell.js";
import type { Io } from "../io.js";
import type { Args } from "../main.js";

export interface DoctorDeps {
  fs: FsDeps;
  ps51Policy(): Promise<string | null>;
}

// Only Windows has launchers. In bash, zsh, and fish the profile function is not visible from here.
async function checkLaunchers(io: Io, deps: DoctorDeps): Promise<void> {
    const wins = findOnPath("wtp", { platform: io.platform, env: io.env, isFile: deps.fs.isFile });
    const head = wins ? deps.fs.readHead(wins) : null;
    const version = head === null ? null : markerVersion(head);
    if (!wins) io.stderr.write("! wtp is not set up. Run \"worktree-pool setup\" once.\n");
    else if (version === null) io.stderr.write(`! ${wins} runs as wtp, but it is not a wtp launcher. Run "worktree-pool setup" to see why.\n`);
    else if (version < LAUNCHER_VERSION) io.stderr.write(`! The wtp launcher ${wins} is old. Run "worktree-pool setup" to replace it.\n`);
    else if ((await deps.ps51Policy()) === "Restricted") io.stderr.write(PS51_NOTE);
}

export async function doctorCommand(
    args: Args,
    io: Io,
    deps: DoctorDeps = { fs: realFs, ps51Policy: () => readPs51Policy() }
): Promise<number> {
    if (io.platform === "win32") await checkLaunchers(io, deps);
    const ctx = await resolveContext(io.cwd);
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
