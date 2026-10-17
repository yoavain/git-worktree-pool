import path from "node:path";
import { resolveContext } from "../../core/context.js";
import { describeLoss, free, inspectSlot } from "../../core/free.js";
import { loadPool, requireSlot } from "../../core/pool.js";
import { freedText } from "../../ui/labels.js";
import { parseIndex } from "../args.js";
import type { Io } from "../io.js";
import type { Args } from "../main.js";
import { showPoolAfter } from "../move.js";

export async function freeCommand(args: Args, io: Io): Promise<number> {
    const index = parseIndex(args.positionals[0], "wtp free <index>");
    const ctx = await resolveContext(io.cwd, io.platform);
    const slot = requireSlot(await loadPool(ctx), index, "free");
    if (slot.state === "free") {
        io.stderr.write(`Slot ${index} is already free.\n`);
        return 0;
    }

    if (slot.state === "active" && !args.values.yes) {
        const info = await inspectSlot(slot.path);
        io.stderr.write(`Free slot ${index} (${path.basename(slot.path)}, ${slot.branch ?? "detached"})?\n`);
        for (const line of describeLoss(info)) io.stderr.write(`  ${line}\n`);
        if (!(await io.confirm("Discard and free?"))) {
            io.stderr.write("Aborted. Nothing changed.\n");
            return 1;
        }
    }

    await free(ctx, index, { force: Boolean(args.values.force) });
    io.stderr.write(`${freedText(index)}\n`);
    await showPoolAfter(ctx, slot.path, io);
    return 0;
}
