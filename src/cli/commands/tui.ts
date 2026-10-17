import { resolveContext } from "../../core/context.js";
import type { Io } from "../io.js";
import { moveShellTo } from "../move.js";

export function canRunTui(io: Io): boolean {
    return Boolean(io.stdout.isTTY) && io.stdinIsTTY;
}

export async function tuiCommand(io: Io, mode: "list" | "assign"): Promise<number> {
    const ctx = await resolveContext(io.cwd, io.platform);
    const { runTui } = await import("../../tui/run.js");
    const result = await runTui(ctx, io, { mode });
    for (const note of result.notes ?? []) io.stderr.write(`${note}\n`);
    if (result.cd) {
        if (result.copied) io.stderr.write(`copied ${result.cd}\n`);
        await moveShellTo(result.cd, io, { copy: false, cd: true });
    }
    return 0;
}
