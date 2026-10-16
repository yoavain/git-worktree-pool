import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    isInside, lowestUnusedIndex, markerPath, parseMarkerIndex, parseSlotIndex,
    poolRootFor, samePath, slotDirName, slotPath
} from "../../src/core/naming.js";

const base = path.resolve("/work");

describe("naming", () => {
    it("puts the pool next to the clone", () => {
        expect(poolRootFor(path.join(base, "my-repo"))).toBe(path.join(base, "my-repo-wt-pool"));
    });

    it("names slots and markers", () => {
        const pool = path.join(base, "my-repo-wt-pool");
        expect(slotDirName("my-repo", 3)).toBe("my-repo-wt-3");
        expect(slotPath(pool, "my-repo", 3)).toBe(path.join(pool, "my-repo-wt-3"));
        expect(markerPath(pool, "my-repo", 3)).toBe(path.join(pool, ".my-repo-wt-3"));
    });

    it("parses slot folder names", () => {
        expect(parseSlotIndex("my-repo", "my-repo-wt-12")).toBe(12);
        expect(parseSlotIndex("my-repo", "my-repo-wt-0")).toBeNull();
        expect(parseSlotIndex("my-repo", "my-repo-wt-01")).toBeNull();
        expect(parseSlotIndex("my-repo", "my-repo-wt-x")).toBeNull();
        expect(parseSlotIndex("my-repo", "other-wt-1")).toBeNull();
        expect(parseSlotIndex("my", "my-repo-wt-1")).toBeNull();
    });

    it("parses marker file names", () => {
        expect(parseMarkerIndex("my-repo", ".my-repo-wt-3")).toBe(3);
        expect(parseMarkerIndex("my-repo", "my-repo-wt-3")).toBeNull();
        expect(parseMarkerIndex("my-repo", ".wtp.lock")).toBeNull();
    });

    it("finds the lowest unused index", () => {
        expect(lowestUnusedIndex([])).toBe(1);
        expect(lowestUnusedIndex([1, 2, 3])).toBe(4);
        expect(lowestUnusedIndex([1, 3, 4])).toBe(2);
    });

    it("tests whether a path is inside another", () => {
        expect(isInside(path.join(base, "a", "b"), path.join(base, "a"))).toBe(true);
        expect(isInside(path.join(base, "a"), path.join(base, "a"))).toBe(true);
        expect(isInside(path.join(base, "ab"), path.join(base, "a"))).toBe(false);
        expect(isInside(base, path.join(base, "a"))).toBe(false);
    });

    it.runIf(process.platform === "win32")("ignores case and slash style on Windows", () => {
        expect(samePath("C:/Work/My-Repo", "c:\\work\\my-repo")).toBe(true);
        expect(isInside("c:\\work\\my-repo\\src", "C:/Work/My-Repo")).toBe(true);
    });

    it.runIf(process.platform !== "win32")("respects case on POSIX", () => {
        expect(samePath("/work/My-Repo", "/work/my-repo")).toBe(false);
    });
});
