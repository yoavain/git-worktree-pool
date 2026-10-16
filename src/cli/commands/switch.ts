import { resolveContext } from "../../core/context.js";
import { UserError } from "../../core/errors.js";
import { findSlot, loadPool } from "../../core/pool.js";
import { parseIndex } from "../args.js";
import type { Io } from "../io.js";
import type { Args } from "../main.js";
import { moveShellTo } from "../move.js";
import { canRunTui, tuiCommand } from "./tui.js";

export async function switchCommand(args: Args, io: Io): Promise<number> {
    if (args.positionals[0] === undefined && canRunTui(io)) return tuiCommand(io, "list");
    const index = parseIndex(args.positionals[0], "wtp switch <index>");
    const pool = await loadPool(await resolveContext(io.cwd));
    const slot = findSlot(pool, index);
    if (!slot || slot.state === "broken") {
        const valid = pool.slots.filter((s) => s.state !== "broken").map((s) => s.index).join(", ");
        throw new UserError(`There is no slot ${index}. Valid slots: ${valid}`);
    }
    if (slot.state === "free") io.stderr.write(`! Slot ${index} is free. Give it a branch with: wtp assign <branch>\n`);
    await moveShellTo(slot.path, io, { copy: true, cd: true });
    return 0;
}
