import { assign } from "../../core/assign.js";
import { resolveContext } from "../../core/context.js";
import { BranchInUseError, UserError } from "../../core/errors.js";
import { loadPool } from "../../core/pool.js";
import type { Io } from "../io.js";
import { cliFailure, runLifecycle, SCRIPT_FAILED_EXIT, withSigint } from "../lifecycle.js";
import type { Args } from "../main.js";
import { assignSummary } from "../../ui/labels.js";
import { moveShellTo } from "../move.js";
import { renderPlainTable } from "./list.js";
import { canRunTui, tuiCommand } from "./tui.js";

export async function assignCommand(args: Args, io: Io): Promise<number> {
    const name = args.positionals[0];
    if (!name) {
        if (canRunTui(io)) return tuiCommand(io, "assign");
        throw new UserError("Usage: wtp assign <branch>");
    }
    const ctx = await resolveContext(io.cwd, io.platform);

    let r;
    try {
        r = await assign(ctx, name);
    }
    catch (e) {
        if (!(e instanceof BranchInUseError) || e.index === null) throw e;
        if (!io.stdinIsTTY) throw new UserError(`${name} is already in slot ${e.index}. Run: wtp switch ${e.index}`);
        if (!(await io.confirm(`${name} is already in slot ${e.index}. Switch there?`, { defaultYes: true }))) return 1;
        await moveShellTo(e.path, io, { copy: true, cd: true });
        return 0;
    }

    if (r.createdPoolRoot) io.stderr.write(`created the pool folder ${ctx.poolRoot}\n`);
    for (const w of r.warnings) io.stderr.write(`! ${w}\n`);
    io.stderr.write(`${assignSummary(name, r)}\n`);

    // A failed setup keeps the slot, and the shell still moves there, so the user can fix it in place.
    let failed = false;
    if (!args.values["no-setup"]) {
        const setup = await withSigint((signal) => runLifecycle("setup", { root: ctx.root, index: r.index, path: r.path, branch: name }, {
            env: io.env,
            platform: io.platform,
            home: io.home,
            output: "inherit",
            signal,
            onStart: (display) => io.stderr.write(`setup: ${display}\n`),
            warn: (w) => io.stderr.write(`! ${w}\n`)
        }));
        if (setup.status === "failed") {
            cliFailure("setup", setup, io);
            failed = true;
        }
    }

    const cd = !args.values["no-cd"];
    await moveShellTo(r.path, io, { copy: true, cd });
    io.stdout.write(renderPlainTable(await loadPool({ ...ctx, cwd: cd ? r.path : ctx.cwd }, { changes: true }), io));
    return failed ? SCRIPT_FAILED_EXIT : 0;
}
