import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { AssignPopup } from "../../src/tui/AssignPopup.js";
import { Footer, KEYS_LIST } from "../../src/tui/Footer.js";
import { Help } from "../../src/tui/Help.js";
import { PoolTable } from "../../src/tui/PoolTable.js";
import { Popup } from "../../src/tui/Popup.js";
import type { Row } from "../../src/ui/table.js";

const rows: Row[] = [
    { index: "0", branch: "main", folder: "my-repo", changes: "clean", state: "root", tone: "root", isCurrent: false, path: "/d/my-repo", slotIndex: 0 },
    { index: "1", branch: "feature/login-form", folder: "my-repo-wt-pool/my-repo-wt-1", changes: "+42 -7", state: "active ● here", tone: "active", isCurrent: true, path: "/d/p/1", slotIndex: 1 },
    { index: "3", branch: "—", folder: "my-repo-wt-pool/my-repo-wt-3", changes: "—", state: "free", tone: "free", isCurrent: false, path: "/d/p/3", slotIndex: 3 }
];

describe("TUI components", () => {
    it("draws the table with a header and a selection marker", () => {
        const frame = render(<PoolTable rows={rows} selected={2} width={100} />).lastFrame()!;
        const lines = frame.split("\n");
        expect(lines[0]).toMatch(/#\s+BRANCH\s+FOLDER\s+CHANGES\s+STATE/);
        expect(lines[3]).toContain("▶");
        expect(lines[3]).toContain("free");
        expect(lines[2]).not.toContain("▶");
    });

    it("drops the folder column when the terminal is narrow", () => {
        expect(render(<PoolTable rows={rows} selected={0} width={50} />).lastFrame()).not.toContain("FOLDER");
    });

    it("draws a popup with lines, keys, and a checkbox", () => {
        const frame = render(
            <Popup title="Delete slot 1?" tone="danger" lines={["The folder is removed from disk."]} keys="y delete  n cancel"
                checkbox={{ label: "also delete local branch feature/login-form", checked: true }} />
        ).lastFrame()!;
        expect(frame).toContain("Delete slot 1?");
        expect(frame).toContain("The folder is removed from disk.");
        expect(frame).toContain("[x] also delete local branch");
        expect(frame).toContain("y delete");
    });

    it("draws the assign popup with sources and the target slot", () => {
        const frame = render(
            <AssignPopup query="feat/pay" selected={1} target="slot 3 (free, reused)" exits={false}
                suggestions={[{ name: "feat/payments-v2", source: "local" }, { name: "feat/payment-retry", source: "remote" }, { name: "feat/pay", source: "new" }]} />
        ).lastFrame()!;
        expect(frame).toContain("Branch  feat/pay");
        expect(frame).toContain("feat/payments-v2");
        expect(frame).toContain("origin");
        expect(frame).toContain("+ new branch \"feat/pay\"");
        expect(frame).toMatch(/▶ feat\/payment-retry/);
        expect(frame).toContain("slot 3 (free, reused)");
    });

    it("draws the footer message and keys", () => {
        const frame = render(<Footer message={{ tone: "ok", text: "✓ copied /d/p/1" }} keys={KEYS_LIST} />).lastFrame()!;
        expect(frame).toContain("✓ copied /d/p/1");
        expect(frame).toContain("a assign");
    });

    it("lists every key in the help screen", () => {
        const frame = render(<Help />).lastFrame()!;
        for (const k of ["Enter", "assign", "free", "delete", "copy", "filter", "quit"]) expect(frame).toContain(k);
        // Quit moves the shell to the clone after you free or delete the slot you are in.
        expect(frame).not.toContain("quit without cd");
        expect(frame).toContain("to the clone");
    });
});
