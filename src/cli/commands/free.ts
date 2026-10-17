import path from "node:path";
import { resolveContext } from "../../core/context.js";
import { assertFreeable, describeLoss, free, inspectSlot } from "../../core/free.js";
import { loadPool, requireSlot } from "../../core/pool.js";
import { freedText } from "../../ui/labels.js";
import { parseIndex } from "../args.js";
import type { Io } from "../io.js";
import { afterTeardown, cliTeardown } from "../lifecycle.js";
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

    const force = Boolean(args.values.force);
    const tore = slot.state === "active" && !args.values["no-teardown"];
    let teardown: "ran" | "skipped" | "interrupted" = "skipped";
    if (tore) {
        assertFreeable(slot, index, force);
        teardown = await cliTeardown(ctx.root, slot, io);
        if (teardown === "interrupted") {
            io.stderr.write(`Teardown interrupted. Slot ${index} was not freed.\n`);
            return 1;
        }
    }
    await afterTeardown(teardown === "ran", () => free(ctx, index, { force, expectBranch: tore ? slot.branch : undefined }));
    io.stderr.write(`${freedText(index)}\n`);
    await showPoolAfter(ctx, slot.path, io);
    return 0;
}
