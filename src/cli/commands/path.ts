import { resolveContext } from "../../core/context.js";
import { UserError } from "../../core/errors.js";
import { findSlot, loadPool } from "../../core/pool.js";
import { parseIndex } from "../args.js";
import type { Io } from "../io.js";
import type { Args } from "../main.js";

export async function pathCommand(args: Args, io: Io): Promise<number> {
    const index = parseIndex(args.positionals[0], "wtp path <index>");
    const pool = await loadPool(await resolveContext(io.cwd, io.platform));
    const slot = findSlot(pool, index);
    if (!slot || slot.state === "broken") throw new UserError(`There is no slot ${index}.`);
    io.stdout.write(slot.path + "\n");
    return 0;
}
