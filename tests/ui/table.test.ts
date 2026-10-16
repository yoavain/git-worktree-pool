import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Context } from "../../src/core/context.js";
import type { Pool, Slot } from "../../src/core/pool.js";
import {
    buildRows, formatChanges, formatTable, layoutColumns, nextAssignHint, truncateMiddle
} from "../../src/ui/table.js";

const parent = path.resolve("/dev");
const ctx: Context = {
    cwd: path.join(parent, "my-repo"),
    root: path.join(parent, "my-repo"),
    repoName: "my-repo",
    poolRoot: path.join(parent, "my-repo-wt-pool")
};

function slot(p: Partial<Slot> & Pick<Slot, "index" | "state">): Slot {
    const dir = p.index === 0 ? ctx.root : path.join(ctx.poolRoot, `my-repo-wt-${p.index}`);
    return { path: dir, branch: null, head: "abcdef1234", locked: false, isCurrent: false, ...p };
}

const pool: Pool = {
    ctx,
    slots: [
        slot({ index: 0, state: "root", branch: "main", changes: { added: 0, removed: 0, changed: 0, untracked: 0, ahead: 0, behind: 0 } }),
        slot({ index: 1, state: "active", branch: "feature/login-form", isCurrent: true, changes: { added: 42, removed: 7, changed: 3, untracked: 2, ahead: 1, behind: 0 } }),
        slot({ index: 3, state: "free" })
    ],
    external: [{ path: path.join(parent, "elsewhere"), branch: "side", isCurrent: false }]
};

describe("formatChanges", () => {
    it("formats counts", () => {
        expect(formatChanges({ added: 42, removed: 7, changed: 3, untracked: 2, ahead: 1, behind: 3 })).toBe("+42 -7 ?2 ↑1 ↓3");
    });
    it("shows clean, loading, and unknown", () => {
        expect(formatChanges({ added: 0, removed: 0, changed: 0, untracked: 0, ahead: 0, behind: 0 })).toBe("clean");
        expect(formatChanges(undefined, "…")).toBe("…");
        expect(formatChanges(null)).toBe("?");
    });
    it("shows ~N when files changed without line counts", () => {
        expect(formatChanges({ added: 0, removed: 0, changed: 2, untracked: 0, ahead: 0, behind: 0 })).toBe("~2");
    });
});

describe("buildRows", () => {
    it("builds slot and external rows", () => {
        const rows = buildRows(pool);
        expect(rows.map((r) => [r.index, r.branch, r.folder, r.state])).toEqual([
            ["0", "main", "my-repo", "root"],
            ["1", "feature/login-form", path.join("my-repo-wt-pool", "my-repo-wt-1"), "active ● here"],
            ["3", "—", path.join("my-repo-wt-pool", "my-repo-wt-3"), "free"],
            ["-", "side", "elsewhere", "other"]
        ]);
        expect(rows[1]?.changes).toBe("+42 -7 ?2 ↑1");
        expect(rows[2]?.changes).toBe("—");
    });

    it("hides the current marker on request", () => {
        expect(buildRows(pool, { showCurrent: false })[1]?.state).toBe("active");
    });

    it("shows the loading text for changes that are not loaded", () => {
        const notLoaded = { ...pool, slots: pool.slots.map((s) => ({ ...s, changes: undefined })) };
        expect(buildRows(notLoaded, { loading: "…" })[0]?.changes).toBe("…");
    });
});

describe("layout", () => {
    it("drops folder, then changes, then truncates the branch", () => {
        const rows = buildRows(pool);
        expect(layoutColumns(rows).columns).toEqual(["index", "branch", "folder", "changes", "state"]);
        // full width 82; without folder 52; without changes 38
        expect(layoutColumns(rows, 55).columns).toEqual(["index", "branch", "changes", "state"]);
        expect(layoutColumns(rows, 36).columns).toEqual(["index", "branch", "state"]);
        expect(layoutColumns(rows, 28).widths.branch).toBeLessThan("feature/login-form".length);
    });

    it("truncates in the middle", () => {
        expect(truncateMiddle("feature/login-form", 9)).toBe("feat…form");
        expect(truncateMiddle("short", 9)).toBe("short");
    });
});

describe("formatTable", () => {
    it("prints a header and aligned rows without color codes", () => {
        const out = formatTable(buildRows(pool), { color: false });
        const lines = out.split("\n");
        expect(lines[0]).toMatch(/^ {2}# +BRANCH +FOLDER +CHANGES +STATE$/);
        expect(out).not.toContain("\x1b[");
        expect(lines[2]?.indexOf("feature/login-form")).toBe(lines[0]?.indexOf("BRANCH"));
    });

    it("adds color codes when asked", () => {
        expect(formatTable(buildRows(pool), { color: true })).toContain("\x1b[");
    });
});

describe("nextAssignHint", () => {
    it("names the slot the next assign uses", () => {
        expect(nextAssignHint(pool)).toBe("next assign → slot 3 (free, reused)");
        expect(nextAssignHint({ ...pool, slots: pool.slots.slice(0, 2) })).toBe("next assign → slot 2 (new)");
    });
});
