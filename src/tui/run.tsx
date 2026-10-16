import { render } from "ink";
import type { Io } from "../cli/io.js";
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
    const actions: TuiActions = {
        reload: () => loadPool(ctx),
        loadChanges: (pool) => withChanges(pool),
        assign: (branch) => assign(ctx, branch, { config }),
        async inspect(index) {
            const slot = findSlot(await loadPool(ctx), index);
            if (!slot) throw new UserError(`There is no slot ${index}.`);
            return inspectSlot(slot.path);
        },
        async free(index) {
            await free(ctx, index);
        },
        async remove(index, o) {
            const r = await deleteSlot(ctx, index, { discard: true, deleteBranch: o.deleteBranch ? "safe" : false });
            return r.warnings;
        },
        listBranches: () => listBranches(ctx, config),
        copy: (text) => io.copy(text)
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
        />
    );
    await app.waitUntilExit();
    return result;
}
