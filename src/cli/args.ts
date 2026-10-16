import { UserError } from "../core/errors.js";

export function parseIndex(value: string | undefined, usage: string): number {
    if (value === undefined || !/^\d+$/.test(value)) throw new UserError(`Usage: ${usage}`);
    return Number(value);
}
