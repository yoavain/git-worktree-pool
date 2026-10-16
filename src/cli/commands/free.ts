import path from "node:path";
import { resolveContext } from "../../core/context.js";
import { UserError } from "../../core/errors.js";
import { describeLoss, free, inspectSlot } from "../../core/free.js";
import { isInside } from "../../core/naming.js";
import { findSlot, loadPool } from "../../core/pool.js";
import { parseIndex } from "../args.js";
import type { Io } from "../io.js";
import type { Args } from "../main.js";
import { moveShellTo } from "../move.js";
import { renderPlainTable } from "./list.js";

export async function freeCommand(args: Args, io: Io): Promise<number> {
    const index = parseIndex(args.positionals[0], "wtp free <index>");
    if (index === 0) throw new UserError("Slot 0 is the clone. It cannot be freed.");
    const ctx = await resolveContext(io.cwd);
    const slot = findSlot(await loadPool(ctx), index);
    if (!slot) throw new UserError(`There is no slot ${index}.`);
    if (slot.state === "free") {
        io.stderr.write(`Slot ${index} is already free.\n`);
        return 0;
    }

    if (slot.state === "active" && !args.values.yes) {
        const info = await inspectSlot(slot.path);
        io.stderr.write(`Free slot ${index} (${path.basename(slot.path)} · ${slot.branch ?? "detached"})?\n`);
        for (const line of describeLoss(info)) io.stderr.write(`  ${line}\n`);
        if (!(await io.confirm("Discard and free?"))) {
            io.stderr.write("Aborted. Nothing changed.\n");
            return 1;
        }
    }

    await free(ctx, index, { force: Boolean(args.values.force) });
    io.stderr.write(`slot ${index} is free\n`);
    const inside = isInside(ctx.cwd, slot.path);
    if (inside) await moveShellTo(ctx.root, io, { copy: false, cd: true });
    io.stdout.write(renderPlainTable(await loadPool({ ...ctx, cwd: inside ? ctx.root : ctx.cwd }, { changes: true }), io));
    return 0;
}
