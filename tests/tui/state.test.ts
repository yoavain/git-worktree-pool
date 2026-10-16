import { describe, expect, it } from "vitest";
import { createDigitBuffer, initialSelection, moveSelection, visibleRows } from "../../src/tui/state.js";
import type { Row } from "../../src/ui/table.js";

function row(index: string, branch: string, isCurrent = false): Row {
    return { index, branch, folder: `f${index}`, changes: "", state: "active", tone: "active", isCurrent, path: `/p/${index}`, slotIndex: Number(index) };
}

const rows = [row("0", "main"), row("1", "feature/login-form", true), row("2", "fix/null-token"), row("12", "chore/deps")];

describe("TUI state helpers", () => {
    it("filters by branch, ignoring case", () => {
        expect(visibleRows(rows, "LOGIN").map((r) => r.index)).toEqual(["1"]);
        expect(visibleRows(rows, "")).toHaveLength(4);
    });

    it("keeps the selection inside the list", () => {
        expect(moveSelection(0, -1, 4)).toBe(0);
        expect(moveSelection(3, 1, 4)).toBe(3);
        expect(moveSelection(1, 1, 4)).toBe(2);
        expect(moveSelection(0, 1, 0)).toBe(0);
    });

    it("starts on the current row", () => {
        expect(initialSelection(rows)).toBe(1);
        expect(initialSelection([row("0", "main")])).toBe(0);
    });

    it("jumps by index and joins quick digits", () => {
        const buf = createDigitBuffer(600);
        expect(buf.push("2", 1000, rows)).toBe(2);
        expect(buf.push("1", 5000, rows)).toBe(1);
        expect(buf.push("2", 5100, rows)).toBe(3);
        expect(buf.push("9", 9000, rows)).toBeNull();
    });
});
