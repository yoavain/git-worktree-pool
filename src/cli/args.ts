import { UserError } from "../core/errors.js";

// For "<index|branch>": all digits is a slot index, anything else a branch name.
export function isIndex(value: string): boolean {
    return /^\d+$/.test(value);
}

export function parseIndex(value: string | undefined, usage: string): number {
    if (value === undefined || !/^\d+$/.test(value)) throw new UserError(`Usage: ${usage}`);
    return Number(value);
}
