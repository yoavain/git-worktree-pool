import { describe, expect, it } from "vitest";
import { explainGitError } from "../../src/cli/explain.js";
import { GitError } from "../../src/core/errors.js";

describe("explainGitError", () => {
    it("adds the long-path hint on Windows path errors", () => {
        const e = explainGitError(new GitError(["worktree", "add"], 128, "error: unable to create file a/b/c: Filename too long"));
        expect(e.message).toContain("git config --global core.longpaths true");
        expect(e.exitCode).toBe(3);
    });

    it("adds the safe.directory hint", () => {
        const e = explainGitError(new GitError(["status"], 128, "fatal: detected dubious ownership in repository at 'C:/x'"));
        expect(e.message).toContain("safe.directory");
    });

    it("returns other errors unchanged", () => {
        const original = new GitError(["status"], 1, "something else");
        expect(explainGitError(original)).toBe(original);
    });
});
