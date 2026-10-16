import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/tui/run.js", () => ({
    runTui: vi.fn(async () => ({ cd: "/somewhere", copied: true }))
}));

import { main } from "../../src/cli/main.js";
import { runTui } from "../../src/tui/run.js";
import { makeIo } from "../helpers/io.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

describe("TUI wiring", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
        vi.mocked(runTui).mockClear();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    it("opens the TUI list with no arguments in a terminal, then hands off the folder", async () => {
        const t = makeIo(fx.root, { tty: true });
        expect(await main([], t.io)).toBe(0);
        expect(runTui).toHaveBeenCalledWith(expect.objectContaining({ repoName: "my-repo" }), t.io, { mode: "list" });
        expect(await t.cwdTarget()).toBe("/somewhere");
        expect(t.err()).toContain("✓ copied /somewhere");
    });

    it("opens assign mode for wtp assign with no branch in a terminal", async () => {
        const t = makeIo(fx.root, { tty: true });
        expect(await main(["assign"], t.io)).toBe(0);
        expect(runTui).toHaveBeenCalledWith(expect.anything(), t.io, { mode: "assign" });
    });

    it("opens the list for wtp switch with no index in a terminal", async () => {
        const t = makeIo(fx.root, { tty: true });
        expect(await main(["switch"], t.io)).toBe(0);
        expect(runTui).toHaveBeenCalledWith(expect.anything(), t.io, { mode: "list" });
    });

    it("prints the plain table when not in a terminal", async () => {
        const t = makeIo(fx.root, { tty: false });
        expect(await main([], t.io)).toBe(0);
        expect(runTui).not.toHaveBeenCalled();
        expect(t.out()).toContain("BRANCH");
    });

    it("prints the notes the TUI hands back", async () => {
        vi.mocked(runTui).mockResolvedValueOnce({ cd: "/somewhere", copied: true, notes: ["! Could not fetch from origin."] });
        const t = makeIo(fx.root, { tty: true });
        expect(await main(["assign"], t.io)).toBe(0);
        expect(t.err()).toContain("! Could not fetch from origin.");
    });

    it("does nothing more when the TUI exits without a folder", async () => {
        vi.mocked(runTui).mockResolvedValueOnce({ cd: null, copied: false });
        const t = makeIo(fx.root, { tty: true });
        expect(await main([], t.io)).toBe(0);
        expect(await t.cwdTarget()).toBe("");
    });
});
