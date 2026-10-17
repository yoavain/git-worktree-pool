import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type { AssignResult } from "../../src/core/assign.js";
import type { Context } from "../../src/core/context.js";
import { BranchInUseError } from "../../src/core/errors.js";
import type { Pool, Slot } from "../../src/core/pool.js";
import { App, type AppProps, type TuiActions } from "../../src/tui/App.js";

const ctx: Context = { cwd: "/d/my-repo-wt-pool/my-repo-wt-1", root: "/d/my-repo", repoName: "my-repo", poolRoot: "/d/my-repo-wt-pool", platform: "linux" };
const zero = { added: 0, removed: 0, changed: 0, untracked: 0, ahead: 0, behind: 0 };
const s = (p: Partial<Slot> & Pick<Slot, "index" | "state" | "path">): Slot =>
    ({ branch: null, head: "abcdef1", locked: false, isCurrent: false, changes: zero, ...p });

const pool: Pool = {
    ctx,
    external: [],
    slots: [
        s({ index: 0, state: "root", path: "/d/my-repo", branch: "main" }),
        s({ index: 1, state: "active", path: "/d/my-repo-wt-pool/my-repo-wt-1", branch: "feature/login-form", isCurrent: true }),
        s({ index: 2, state: "active", path: "/d/my-repo-wt-pool/my-repo-wt-2", branch: "fix/null-token" }),
        s({ index: 3, state: "free", path: "/d/my-repo-wt-pool/my-repo-wt-3", changes: undefined })
    ]
};

const KEY = { up: "\u001B[A", down: "\u001B[B", enter: "\r", esc: "\u001B" };
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

function setup(overrides: Partial<TuiActions> = {}, props: Partial<AppProps> = {}) {
    const assignResult: AssignResult = {
        index: 3, path: "/d/my-repo-wt-pool/my-repo-wt-3", reused: true,
        plan: { kind: "local", name: "x" }, createdPoolRoot: false, warnings: []
    };
    const actions: TuiActions = {
        reload: vi.fn(async () => pool),
        loadChanges: vi.fn(async (p: Pool) => p),
        assign: vi.fn(async () => assignResult),
        inspect: vi.fn(async () => ({ branch: "feature/login-form", modified: 3, untracked: 2, unpushed: 1 })),
        free: vi.fn(async () => {}),
        remove: vi.fn(async () => []),
        listBranches: vi.fn(async () => [
            { name: "feat/payments-v2", source: "local" as const },
            { name: "feat/payment-retry", source: "remote" as const }
        ]),
        copy: vi.fn(async () => "native" as const),
        ...overrides
    };
    const onExit = vi.fn();
    const r = render(<App initialPool={pool} actions={actions} platform="linux" onExit={onExit} {...props} />);
    const selectedLine = () => r.lastFrame()!.split("\n").find((l) => l.includes("▶")) ?? "";
    const press = async (...keys: string[]) => {
        for (const k of keys) {
            r.stdin.write(k);
            await tick();
        }
    };
    return { ...r, actions, onExit, selectedLine, press };
}

describe("App", () => {
    it("starts on the current slot and moves with the arrows", async () => {
        const t = setup();
        await tick();
        expect(t.selectedLine()).toContain("feature/login-form");
        await t.press(KEY.down);
        expect(t.selectedLine()).toContain("fix/null-token");
        await t.press(KEY.up, KEY.up);
        expect(t.selectedLine()).toContain("main");
    });

    it("copies the path and exits with cd on Enter", async () => {
        const t = setup();
        await t.press(KEY.down, KEY.enter);
        expect(t.actions.copy).toHaveBeenCalledWith("/d/my-repo-wt-pool/my-repo-wt-2");
        expect(t.onExit).toHaveBeenCalledWith({ cd: "/d/my-repo-wt-pool/my-repo-wt-2", copied: true });
    });

    it("exits without cd on q", async () => {
        const t = setup();
        await t.press("q");
        expect(t.onExit).toHaveBeenCalledWith({ cd: null, copied: false });
    });

    it("jumps by digit and asks before going into a free slot", async () => {
        const t = setup();
        await t.press("3");
        expect(t.selectedLine()).toContain("free");
        await t.press(KEY.enter);
        expect(t.lastFrame()).toContain("Slot 3 is free");
        await t.press("y");
        expect(t.onExit).toHaveBeenCalledWith({ cd: "/d/my-repo-wt-pool/my-repo-wt-3", copied: true });
    });

    it("frees after a confirmation that names the lost data, and goes to the root on quit", async () => {
        const t = setup();
        await t.press("f");
        expect(t.lastFrame()).toContain("3 modified and 2 untracked files will be discarded.");
        expect(t.lastFrame()).toContain("moves you to the root");
        await t.press("y");
        expect(t.actions.free).toHaveBeenCalledWith(1);
        expect(t.lastFrame()).toContain("Slot 1 is free.");
        await t.press("q");
        expect(t.onExit).toHaveBeenCalledWith({ cd: "/d/my-repo", copied: false });
    });

    it("cancels a free with n", async () => {
        const t = setup();
        await t.press("f", "n");
        expect(t.actions.free).not.toHaveBeenCalled();
        expect(t.lastFrame()).not.toContain("Free slot");
    });

    it("deletes with the branch checkbox", async () => {
        const t = setup();
        await t.press("2", "d");
        expect(t.lastFrame()).toContain("[ ] also delete local branch fix/null-token");
        await t.press(" ");
        expect(t.lastFrame()).toContain("[x] also delete local branch");
        await t.press("y");
        expect(t.actions.remove).toHaveBeenCalledWith(2, { deleteBranch: true });
        expect(t.lastFrame()).toContain("Slot 2 is deleted.");
    });

    it("refuses to delete the current slot on Windows", async () => {
        const t = setup({}, { platform: "win32" });
        await t.press("d");
        expect(t.lastFrame()).toContain("Windows can't delete it");
        expect(t.lastFrame()).not.toContain("Delete slot");
    });

    it("refuses to free or delete slot 0", async () => {
        const t = setup();
        await t.press("0", "f");
        expect(t.lastFrame()).toContain("cannot be freed");
        await t.press("d");
        expect(t.lastFrame()).toContain("never deletes it");
    });

    it("assigns a suggested branch and exits with cd", async () => {
        const t = setup();
        await t.press("a");
        expect(t.actions.listBranches).toHaveBeenCalled();
        await t.press("pay");
        expect(t.lastFrame()).toContain("feat/payments-v2");
        expect(t.lastFrame()).toContain("Target  slot 3 (free, reused)");
        await t.press(KEY.enter);
        expect(t.actions.assign).toHaveBeenCalledWith("feat/payments-v2");
        expect(t.actions.copy).toHaveBeenCalledWith("/d/my-repo-wt-pool/my-repo-wt-3");
        expect(t.onExit).toHaveBeenCalledWith(expect.objectContaining({ cd: "/d/my-repo-wt-pool/my-repo-wt-3", copied: true }));
    });

    it("passes the fetch warning and the branch source out of the TUI", async () => {
        const t = setup({
            assign: vi.fn(async (): Promise<AssignResult> => ({
                index: 3, path: "/d/my-repo-wt-pool/my-repo-wt-3", reused: false,
                plan: { kind: "new", name: "feat/colleague", base: "main" }, createdPoolRoot: true,
                warnings: ["Could not fetch from origin (offline). wtp used the local refs."]
            }))
        });
        await t.press("a", "feat/colleague", KEY.enter);
        const result = t.onExit.mock.calls[0]?.[0];
        expect(result.cd).toBe("/d/my-repo-wt-pool/my-repo-wt-3");
        expect(result.notes).toEqual([
            "created the pool folder /d/my-repo-wt-pool",
            "! Could not fetch from origin (offline). wtp used the local refs.",
            "branch feat/colleague (new from main) → slot 3 (new)"
        ]);
    });

    it("assigns a new branch by its typed name", async () => {
        const t = setup();
        await t.press("a", "feat/zzz", KEY.enter);
        expect(t.actions.assign).toHaveBeenCalledWith("feat/zzz");
    });

    it("completes with Tab and edits with backspace", async () => {
        const t = setup();
        await t.press("a", "pay", "\t");
        expect(t.lastFrame()).toContain("Branch  feat/payments-v2");
        await t.press("\u007F");
        expect(t.lastFrame()).toContain("Branch  feat/payments-v");
        expect(t.lastFrame()).not.toContain("Branch  feat/payments-v2");
    });

    it("moves to the slot that already has the branch", async () => {
        const t = setup({
            assign: vi.fn(async () => {
                throw new BranchInUseError("fix/null-token", 2, "/d/my-repo-wt-pool/my-repo-wt-2");
            })
        });
        await t.press("a", "fix/null-token", KEY.enter);
        expect(t.lastFrame()).toContain("already in slot 2");
        expect(t.selectedLine()).toContain("fix/null-token");
        expect(t.onExit).not.toHaveBeenCalled();
    });

    it("filters rows and clears the filter with Esc", async () => {
        const t = setup();
        await t.press("/", "login");
        expect(t.lastFrame()).toContain("feature/login-form");
        expect(t.lastFrame()).not.toContain("fix/null-token");
        await t.press(KEY.esc);
        expect(t.lastFrame()).toContain("fix/null-token");
    });

    it("shows help and closes it on any key", async () => {
        const t = setup();
        await t.press("?");
        expect(t.lastFrame()).toContain("Press any key to go back.");
        await t.press("x");
        expect(t.lastFrame()).not.toContain("Press any key to go back.");
    });

    it("copies the path", async () => {
        const t = setup();
        await t.press("c");
        expect(t.actions.copy).toHaveBeenCalledWith("/d/my-repo-wt-pool/my-repo-wt-1");
        expect(t.lastFrame()).toContain("✓ copied");
    });

    it("has no refresh key: r does nothing, and neither the footer nor the help mentions refresh", async () => {
        const t = setup();
        const before = t.lastFrame();
        await t.press("r");
        expect(t.actions.reload).not.toHaveBeenCalled();
        expect(t.lastFrame()).toBe(before);
        expect(t.lastFrame()).not.toMatch(/refresh/i);
        await t.press("?");
        expect(t.lastFrame()).not.toMatch(/refresh/i);
    });

    it("has no tab key: t does nothing, and neither the footer nor the help mentions a tab", async () => {
        const t = setup();
        const before = t.lastFrame();
        await t.press("t");
        expect(t.lastFrame()).toBe(before);
        expect(t.lastFrame()).not.toMatch(/\btab\b/);
        await t.press("?");
        expect(t.lastFrame()).not.toMatch(/\btab\b/);
    });

    it("opens straight into assign mode", async () => {
        const t = setup({}, { initialMode: "assign" });
        await tick();
        expect(t.lastFrame()).toContain("Assign a worktree");
        expect(t.actions.listBranches).toHaveBeenCalled();
    });

    it("shows an error from a failed action and stays open", async () => {
        const t = setup({ free: vi.fn(async () => {
            throw new Error("git reset failed");
        }) });
        await t.press("f", "y");
        expect(t.lastFrame()).toContain("git reset failed");
        expect(t.onExit).not.toHaveBeenCalled();
    });
});
