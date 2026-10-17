import { rm } from "node:fs/promises";
import path from "node:path";
import {
    chooseFolder, isCurrentLauncher, isMarked, launcherNames, launcherSourceDir, listMarkedLaunchers, realFs,
    scanWtp, writeLaunchers, type Conflict, type FsDeps
} from "../../platform/launchers.js";
import { findOnPath } from "../../platform/path-search.js";
import { adminCopy, PS51_NOTE, readPs51Policy } from "../../platform/powershell.js";
import { parentChain, type ProcInfo } from "../../platform/process-tree.js";
import {
    hasIntegration, installIntegration, profilePath, removeIntegration, SHELLS, shellForSetup, type Shell
} from "../../platform/shell-init.js";
import type { Io } from "../io.js";
import type { Args } from "../main.js";

export interface SetupDeps {
  fs: FsDeps;
  srcDir: string;
  parents(): Promise<ProcInfo[]>;
  ps51Policy(): Promise<string | null>;
  adminCopy(files: string[], dir: string): Promise<boolean>;
}

export function defaultSetupDeps(): SetupDeps {
    return {
        fs: realFs,
        srcDir: launcherSourceDir(),
        parents: () => parentChain(process.ppid, { platform: process.platform }),
        ps51Policy: () => readPs51Policy(),
        adminCopy: (files, dir) => adminCopy(files, dir)
    };
}

type Ask = (question: string) => Promise<boolean>;

function conflictText(c: Conflict): string {
    switch (c.where) {
        case "before":
            return `! ${c.file} runs as wtp before the launcher would. If it is an old wtp install, uninstall it. Otherwise remove or rename it.\n`;
        case "after":
            return `! The wtp launcher would hide ${c.file}. If it is an old wtp install, uninstall it. Otherwise remove or rename it.\n`;
        case "target":
            return `! ${c.file} is not a wtp launcher, and setup does not overwrite it.\n`;
    }
}

function manualText(names: readonly string[], srcDir: string, dir: string | null): string {
    const to = dir ?? "<a folder on PATH>";
    const lines = names.map((n) => `  copy "${path.join(srcDir, n)}" "${to}"`);
    return `Copy the wtp launchers by hand into a folder on PATH:\n${lines.join("\n")}\n`;
}

// 'conflict' means setup must stop before any other change.
type StepResult = "ok" | "failed" | "conflict";

async function setupLaunchers(io: Io, deps: SetupDeps, ask: Ask): Promise<StepResult> {
    const search = { platform: io.platform, env: io.env };
    const names = launcherNames(io.platform);
    const choice = chooseFolder({ ...search, parents: await deps.parents(), fs: deps.fs });

    if (choice.kind === "none") {
        if (io.platform === "win32") {
            io.stderr.write(manualText(names, deps.srcDir, choice.dir));
            return "failed";
        }
        const why = choice.dir ? `${choice.dir} is not writable` : "no folder on PATH holds worktree-pool";
        io.stderr.write(`Skipped the wtp launcher: ${why}. The wtp function in your profile still gives you wtp.\n`);
        return "ok";
    }

    const scan = scanWtp(choice.dir, { ...search, fs: deps.fs });
    if (scan.conflicts.length > 0) {
        for (const c of scan.conflicts) io.stderr.write(conflictText(c));
        io.stderr.write("Nothing changed. Remove or rename that file, then run \"worktree-pool setup\" again.\n");
        return "conflict";
    }
    for (const old of scan.stale) {
        if (!(await ask(`Remove the old wtp launcher ${old}?`))) continue;
        await rm(old, { force: true });
        io.stderr.write(`removed ${old}\n`);
    }

    const pending = names.filter((n) => !isCurrentLauncher(path.join(choice.dir, n), deps.fs));
    if (pending.length === 0) {
        io.stderr.write(`The wtp launchers in ${choice.dir} are up to date.\n`);
        return "ok";
    }
    if (choice.kind === "admin") {
        io.stderr.write(`${choice.dir} is locked for your account.\n`);
        const asked = await ask(`Copy ${pending.join(", ")} there as administrator? Windows asks for permission.`);
        if (asked) await deps.adminCopy(pending.map((n) => path.join(deps.srcDir, n)), choice.dir);
        // Trust the files, not the exit code: a declined UAC prompt can still exit 0.
        if (asked && pending.every((n) => isCurrentLauncher(path.join(choice.dir, n), deps.fs))) {
            for (const n of pending) io.stderr.write(`wrote ${path.join(choice.dir, n)}\n`);
            return "ok";
        }
        if (asked) io.stderr.write("The administrator copy did not finish.\n");
        io.stderr.write(manualText(pending, deps.srcDir, choice.dir));
        return "failed";
    }
    if (!(await ask(`Write ${pending.join(", ")} to ${choice.dir}?`))) {
        io.stderr.write("Skipped the wtp launchers.\n");
        return "failed";
    }
    for (const r of await writeLaunchers(choice.dir, pending, { platform: io.platform, srcDir: deps.srcDir })) {
        io.stderr.write(`${r.action} ${r.file}\n`);
    }
    return "ok";
}

async function install(io: Io, deps: SetupDeps, ask: Ask): Promise<number> {
    const launchers = await setupLaunchers(io, deps, ask);
    if (launchers === "conflict") return 1;
    let ok = launchers === "ok";

    const shell = shellForSetup(io.platform, io.env, io.home);
    let profileChanged = false;
    if (shell) {
        const file = profilePath(shell, io);
        const r = await installIntegration(shell, { home: io.home, env: io.env, confirm: ask, log: (s) => {
            io.stderr.write(s);
        } });
        if (r === "already") io.stderr.write(`${file} already has the wtp function.\n`);
        else if (r === "installed") {
            io.stderr.write(`added the wtp function to ${file}\n`);
            profileChanged = true;
        }
        else {
            io.stderr.write(`Skipped ${file}.\n`);
            ok = false;
        }
    }

    const wins = findOnPath("wtp", { platform: io.platform, env: io.env, isFile: deps.fs.isFile });
    if (wins) {
        if (isMarked(wins, deps.fs)) io.stderr.write(`wtp runs ${wins}\n`);
        else {
            io.stderr.write(`! wtp runs ${wins}, which is not a wtp launcher. Check your PATH.\n`);
            ok = false;
        }
    }
    if (profileChanged) io.stderr.write("Open a new terminal, or reload your profile, to use the wtp function.\n");
    if (io.platform === "win32" && (await deps.ps51Policy()) === "Restricted") io.stderr.write(PS51_NOTE);
    return ok ? 0 : 1;
}

async function removeAll(io: Io, deps: SetupDeps, ask: Ask): Promise<number> {
    const files = listMarkedLaunchers({ platform: io.platform, env: io.env, fs: deps.fs });
    const shells: Shell[] = [];
    for (const s of SHELLS) if (await hasIntegration(s, io)) shells.push(s);
    if (files.length === 0 && shells.length === 0) {
        io.stderr.write("Nothing to remove.\n");
        return 0;
    }
    const list = [...files, ...shells.map((s) => `the wtp function in ${profilePath(s, io)}`)];
    io.stderr.write(`wtp setup removes:\n${list.map((x) => `  ${x}`).join("\n")}\n`);
    if (!(await ask("Remove them?"))) {
        io.stderr.write("Nothing changed.\n");
        return 1;
    }
    let ok = true;
    for (const f of files) {
        try {
            await rm(f);
            io.stderr.write(`removed ${f}\n`);
        }
        catch {
            io.stderr.write(`! Could not remove ${f}. It may need administrator rights.\n`);
            ok = false;
        }
    }
    for (const s of shells) {
        const f = await removeIntegration(s, io);
        if (f) io.stderr.write(`removed the wtp function from ${f}\n`);
    }
    return ok ? 0 : 1;
}

export async function setupCommand(args: Args, io: Io, deps: SetupDeps = defaultSetupDeps()): Promise<number> {
    // The user ran setup to get these files, so Enter means yes. Removal keeps the safe default, no.
    const defaultYes = !args.values.remove;
    const ask: Ask = (q) => (args.values.yes ? Promise.resolve(true) : io.confirm(q, { defaultYes }));
    return args.values.remove ? removeAll(io, deps, ask) : install(io, deps, ask);
}
