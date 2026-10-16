import type { Row } from "../ui/table.js";

export function visibleRows(rows: Row[], filter: string): Row[] {
    const f = filter.trim().toLowerCase();
    return f ? rows.filter((r) => r.branch.toLowerCase().includes(f)) : rows;
}

export function moveSelection(current: number, delta: number, count: number): number {
    if (count <= 0) return 0;
    return Math.min(count - 1, Math.max(0, current + delta));
}

export function initialSelection(rows: Row[]): number {
    const i = rows.findIndex((r) => r.isCurrent);
    return i < 0 ? 0 : i;
}

export function createDigitBuffer(windowMs = 600): { push(digit: string, now: number, rows: Row[]): number | null } {
    let buffer = "";
    let last = Number.NEGATIVE_INFINITY;
    return {
        push(digit, now, rows) {
            buffer = now - last <= windowMs ? buffer + digit : digit;
            last = now;
            let i = rows.findIndex((r) => r.index === buffer);
            if (i < 0 && buffer.length > 1) {
                buffer = digit;
                i = rows.findIndex((r) => r.index === digit);
            }
            return i < 0 ? null : i;
        }
    };
}
