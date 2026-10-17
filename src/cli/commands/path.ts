import { requireCheckout } from "../../core/branch.js";
import { resolveContext } from "../../core/context.js";
import { UserError } from "../../core/errors.js";
import { findSlot, loadPool } from "../../core/pool.js";
import { isIndex, parseIndex } from "../args.js";
import type { Io } from "../io.js";
import type { Args } from "../main.js";

export async function pathCommand(args: Args, io: Io): Promise<number> {
    const target = args.positionals[0];
    if (target === undefined) throw new UserError("Usage: wtp path <index|branch>");
    const pool = await loadPool(await resolveContext(io.cwd, io.platform));
    if (!isIndex(target)) {
        io.stdout.write(requireCheckout(pool, target).path + "\n");
        return 0;
    }
    const index = parseIndex(target, "wtp path <index|branch>");
    const slot = findSlot(pool, index);
    if (!slot || slot.state === "broken") throw new UserError(`There is no slot ${index}.`);
    io.stdout.write(slot.path + "\n");
    return 0;
}
