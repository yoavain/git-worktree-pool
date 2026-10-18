import { render } from "ink";
import type { Io } from "../cli/io.js";
import { runLifecycle } from "../cli/lifecycle.js";
import { assign } from "../core/assign.js";
import { listBranches } from "../core/branch.js";
import { readConfig } from "../core/config.js";
import type { Context } from "../core/context.js";
import { deleteSlot } from "../core/delete.js";
import { UserError } from "../core/errors.js";
import { free, inspectSlot } from "../core/free.js";
import { findSlot, loadPool, withChanges } from "../core/pool.js";
import { App, type TuiActions, type TuiResult } from "./App.js";

export async function runTui(ctx: Context, io: Io, opts: { mode?: "list" | "assign" } = {}): Promise<TuiResult> {
    const config = await readConfig(ctx.root);
    const warnings: string[] = [];
    const actions: TuiActions = {
        reload: () => loadPool(ctx),
        loadChanges: (pool) => withChanges(pool),
        assign: (branch) => assign(ctx, branch, { config }),
        async inspect(index) {
            const slot = findSlot(await loadPool(ctx), index);
            if (!slot) throw new UserError(`There is no slot ${index}.`);
            return inspectSlot(slot.path);
        },
        async free(index, o) {
            await free(ctx, index, { expectBranch: o.expectBranch });
        },
        async remove(index, o) {
            const r = await deleteSlot(ctx, index, { discard: true, deleteBranch: o.deleteBranch ? "safe" : false, expectBranch: o.expectBranch });
            return r.warnings;
        },
        listBranches: () => listBranches(ctx, config),
        copy: (text) => io.copy(text),
        lifecycle: (key, target, o) => runLifecycle(key, target, {
            env: io.env,
            platform: io.platform,
            home: io.home,
            output: "capture",
            signal: o.signal,
            onStart: o.onStart,
            // Ink owns the screen, so config warnings wait until the TUI exits.
            warn: (w) => warnings.push(`! ${w}`)
        })
    };

    let result: TuiResult = { cd: null, copied: false };
    const app = render(
        <App
            initialPool={await loadPool(ctx)}
            actions={actions}
            initialMode={opts.mode ?? "list"}
            platform={io.platform}
            onExit={(r) => {
                result = r;
            }}
        />,
        { exitOnCtrlC: false }
    );
    await app.waitUntilExit();
    return warnings.length ? { ...result, notes: [...warnings, ...(result.notes ?? [])] } : result;
}
