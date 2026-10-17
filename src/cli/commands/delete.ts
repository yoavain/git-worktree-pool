import path from "node:path";
import { resolveContext } from "../../core/context.js";
import { deleteSlot } from "../../core/delete.js";
import { UserError } from "../../core/errors.js";
import { describeLoss, inspectSlot } from "../../core/free.js";
import { isInside } from "../../core/naming.js";
import { loadPool, requireSlot } from "../../core/pool.js";
import { deletedText } from "../../ui/labels.js";
import { parseIndex } from "../args.js";
import type { Io } from "../io.js";
import type { Args } from "../main.js";
import { showPoolAfter } from "../move.js";

export async function deleteCommand(args: Args, io: Io): Promise<number> {
    const index = parseIndex(args.positionals[0], "wtp delete <index>");
    const ctx = await resolveContext(io.cwd, io.platform);
    const slot = requireSlot(await loadPool(ctx), index, "delete");

    const inside = isInside(ctx.cwd, slot.path, ctx.platform);
    if (inside && io.platform === "win32") {
        throw new UserError(`You are in slot ${index}. Windows can't delete a folder that a shell is in. Run wtp switch 0 first, then wtp delete ${index}.`);
    }

    const force = Boolean(args.values.force);
    // --yes answers the question below, and that question is "discard and delete?", as in free --yes.
    if (!args.values.yes) {
        io.stderr.write(`Delete slot ${index} (${path.basename(slot.path)}, ${slot.branch ?? slot.state})?\n`);
        if (slot.state === "active") {
            const info = await inspectSlot(slot.path);
            // With --branch --force the branch goes too (git branch -D), so "the branch keeps them" would be false.
            const losesCommits = Boolean(args.values.branch && force && info.unpushed);
            for (const line of describeLoss({ ...info, unpushed: losesCommits ? 0 : info.unpushed }).slice(0, -1)) {
                io.stderr.write(`  ${line}\n`);
            }
            if (losesCommits) {
                io.stderr.write(info.unpushed === 1
                    ? "  1 commit is not on any remote and is lost with the branch.\n"
                    : `  ${info.unpushed} commits are not on any remote and are lost with the branch.\n`);
            }
        }
        io.stderr.write("  The folder is removed from disk.\n");
        if (args.values.branch && slot.branch) io.stderr.write(`  The local branch ${slot.branch} is deleted too.\n`);
        if (!(await io.confirm("Delete?"))) {
            io.stderr.write("Aborted. Nothing changed.\n");
            return 1;
        }
    }

    const r = await deleteSlot(ctx, index, {
        discard: true,
        unlock: force,
        deleteBranch: args.values.branch ? (force ? "force" : "safe") : false
    });
    for (const w of r.warnings) io.stderr.write(`! ${w}\n`);
    io.stderr.write(`${deletedText(index, r.branchDeleted ? r.branch : null)}\n`);
    await showPoolAfter(ctx, slot.path, io);
    return 0;
}
