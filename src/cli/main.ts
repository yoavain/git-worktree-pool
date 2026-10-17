import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { GitError, UserError, WtpError } from "../core/errors.js";
import { assignCommand } from "./commands/assign.js";
import { deleteCommand } from "./commands/delete.js";
import { doctorCommand } from "./commands/doctor.js";
import { freeCommand } from "./commands/free.js";
import { helpCommand } from "./commands/help.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { pathCommand } from "./commands/path.js";
import { setupCommand } from "./commands/setup.js";
import { switchCommand } from "./commands/switch.js";
import { canRunTui, tuiCommand } from "./commands/tui.js";
import { explainGitError } from "./explain.js";
import type { Io } from "./io.js";

export interface Args {
  command: string | undefined;
  positionals: string[];
  values: Record<string, boolean | undefined>;
}

export type Command = (args: Args, io: Io) => Promise<number>;

const OPTIONS = {
    "json": { type: "boolean" },
    "no-changes": { type: "boolean" },
    "yes": { type: "boolean", short: "y" },
    "force": { type: "boolean" },
    "branch": { type: "boolean" },
    "no-cd": { type: "boolean" },
    "no-setup": { type: "boolean" },
    "no-teardown": { type: "boolean" },
    "remove": { type: "boolean" },
    "help": { type: "boolean", short: "h" },
    "version": { type: "boolean", short: "v" }
} as const;

export const COMMANDS: Record<string, Command> = {
    list: listCommand,
    ls: listCommand,
    path: pathCommand,
    help: helpCommand,
    assign: assignCommand,
    switch: switchCommand,
    free: freeCommand,
    delete: deleteCommand,
    init: initCommand,
    setup: setupCommand,
    doctor: doctorCommand
};

async function readVersion(): Promise<string> {
    const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    return pkg.version;
}

function parse(argv: string[]): Args {
    try {
        const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
        const [command, ...rest] = positionals;
        return { command, positionals: rest, values: values as Record<string, boolean | undefined> };
    }
    catch (e) {
        throw new UserError(`${(e as Error).message} Run wtp help.`);
    }
}

export async function defaultCommand(args: Args, io: Io): Promise<number> {
    return canRunTui(io) ? tuiCommand(io, "list") : listCommand(args, io);
}

export async function main(argv: string[], io: Io): Promise<number> {
    try {
        const args = parse(argv);
        if (args.values.version) {
            io.stdout.write(`${await readVersion()}\n`);
            return 0;
        }
        if (args.values.help) return await helpCommand(args, io);
        if (!args.command) return await defaultCommand(args, io);
        const command = COMMANDS[args.command];
        if (!command) throw new UserError(`Unknown command "${args.command}". Run wtp help.`);
        return await command(args, io);
    }
    catch (e) {
        const err = e instanceof GitError ? explainGitError(e) : e;
        if (err instanceof WtpError) {
            io.stderr.write(`wtp: ${err.message}\n`);
            return err.exitCode;
        }
        throw err;
    }
}
