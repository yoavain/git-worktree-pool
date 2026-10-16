import { resolveContext } from "../../core/context.js";
import { chooseSlot, loadPool, type Pool } from "../../core/pool.js";
import { colors } from "../../ui/ansi.js";
import { buildRows, formatTable, nextAssignHint } from "../../ui/table.js";
import type { Io } from "../io.js";
import type { Args } from "../main.js";

export function renderPlainTable(pool: Pool, io: Io): string {
    const tty = Boolean(io.stdout.isTTY);
    const color = tty && !io.env.NO_COLOR;
    const table = formatTable(buildRows(pool, { showCurrent: tty }), { color, width: tty ? io.stdout.columns : undefined });
    return `${table}\n\n${colors(color).dim(nextAssignHint(pool))}\n`;
}

export function poolToJson(pool: Pool): object {
    return {
        root: pool.ctx.root,
        poolRoot: pool.ctx.poolRoot,
        repoName: pool.ctx.repoName,
        slots: pool.slots,
        external: pool.external,
        nextAssign: chooseSlot(pool)
    };
}

export async function listCommand(args: Args, io: Io): Promise<number> {
    const ctx = await resolveContext(io.cwd);
    const pool = await loadPool(ctx, { changes: !args.values["no-changes"] });
    io.stdout.write(args.values.json ? JSON.stringify(poolToJson(pool), null, 2) + "\n" : renderPlainTable(pool, io));
    return 0;
}
