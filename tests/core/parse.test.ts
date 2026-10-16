import { describe, expect, it } from "vitest";
import { parseNumstat, parseStatusV2, parseWorktreeList } from "../../src/core/parse.js";

describe("parseWorktreeList", () => {
    it("parses branch, detached, locked, and prunable entries", () => {
        const out = [
            "worktree C:/Dev/my-repo",
            "HEAD 1111111111111111111111111111111111111111",
            "branch refs/heads/main",
            "",
            "worktree C:/Dev/my-repo-wt-pool/my-repo-wt-1",
            "HEAD 2222222222222222222222222222222222222222",
            "branch refs/heads/feature/login-form",
            "locked reason text",
            "",
            "worktree C:/Dev/my-repo-wt-pool/my-repo-wt-3",
            "HEAD 3333333333333333333333333333333333333333",
            "detached",
            "",
            "worktree C:/Dev/my-repo-wt-pool/my-repo-wt-5",
            "HEAD 4444444444444444444444444444444444444444",
            "branch refs/heads/gone",
            "prunable gitdir file points to non-existent location",
            ""
        ].join("\n");
        const e = parseWorktreeList(out);
        expect(e).toHaveLength(4);
        expect(e[0]).toMatchObject({ path: "C:/Dev/my-repo", branch: "main", detached: false, locked: false });
        expect(e[1]).toMatchObject({ branch: "feature/login-form", locked: true });
        expect(e[2]).toMatchObject({ branch: null, detached: true, head: "3333333333333333333333333333333333333333" });
        expect(e[3]).toMatchObject({ prunable: true });
    });

    it("accepts CRLF line ends and a bare entry", () => {
        const e = parseWorktreeList("worktree /srv/repo.git\r\nbare\r\n\r\n");
        expect(e).toEqual([{ path: "/srv/repo.git", head: null, branch: null, detached: false, bare: true, locked: false, prunable: false }]);
    });

    it("keeps spaces and non-ASCII letters in paths", () => {
        expect(parseWorktreeList("worktree C:/dir with space ü/my-repo\nHEAD 1\nbranch refs/heads/main\n")[0]?.path)
            .toBe("C:/dir with space ü/my-repo");
    });
});

describe("parseStatusV2", () => {
    it("counts changes, untracked files, and ahead/behind", () => {
        const out = [
            "# branch.oid 1111111111111111111111111111111111111111",
            "# branch.head feature/x",
            "# branch.upstream origin/feature/x",
            "# branch.ab +2 -3",
            "1 .M N... 100644 100644 100644 aaa bbb src/a.ts",
            "2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts",
            "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
            "? notes.txt",
            "? tmp/",
            "! ignored.txt"
        ].join("\n");
        expect(parseStatusV2(out)).toEqual({ head: "feature/x", upstream: "origin/feature/x", ahead: 2, behind: 3, changed: 3, untracked: 2 });
    });

    it("reports detached HEAD and no upstream", () => {
        expect(parseStatusV2("# branch.oid 1\n# branch.head (detached)\n"))
            .toEqual({ head: null, upstream: null, ahead: 0, behind: 0, changed: 0, untracked: 0 });
    });
});

describe("parseNumstat", () => {
    it("sums lines and skips binary files", () => {
        expect(parseNumstat("10\t2\ta.ts\n-\t-\timage.png\n3\t0\tb.ts\n")).toEqual({ added: 13, removed: 2 });
    });

    it("returns zeros for empty output", () => {
        expect(parseNumstat("")).toEqual({ added: 0, removed: 0 });
    });
});
