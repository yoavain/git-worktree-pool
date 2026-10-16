import { describe, expect, it } from "vitest";
import type { BranchChoice } from "../../src/core/branch.js";
import { fuzzyScore, suggestBranches } from "../../src/tui/fuzzy.js";

const choices: BranchChoice[] = [
    { name: "feat/payments-v2", source: "local" },
    { name: "main", source: "local" },
    { name: "feat/payment-retry", source: "remote" },
    { name: "fix/pay", source: "remote" }
];

describe("fuzzyScore", () => {
    it("returns null when the letters are not in order", () => {
        expect(fuzzyScore("zz", "feat/payments")).toBeNull();
    });

    it("ranks an exact match over a prefix over a scattered match", () => {
        const exact = fuzzyScore("main", "main")!;
        const prefix = fuzzyScore("mai", "main")!;
        const scattered = fuzzyScore("mn", "main")!;
        expect(exact).toBeGreaterThan(prefix);
        expect(prefix).toBeGreaterThan(scattered);
    });
});

describe("suggestBranches", () => {
    it("ranks matches and offers a new branch with the typed name", () => {
        const s = suggestBranches("feat/pay", choices);
        expect(s.map((x) => x.name)).toEqual(["feat/payments-v2", "feat/payment-retry", "feat/pay"]);
        expect(s.at(-1)).toEqual({ name: "feat/pay", source: "new" });
    });

    it("does not offer a new branch when the name exists", () => {
        expect(suggestBranches("fix/pay", choices).some((x) => x.source === "new")).toBe(false);
    });

    it("lists local branches first for an empty query", () => {
        expect(suggestBranches("", choices).map((x) => x.source)).toEqual(["local", "local", "remote", "remote"]);
    });

    it("respects the limit before the new-branch row", () => {
        expect(suggestBranches("a", choices, 2)).toHaveLength(3);
    });
});
