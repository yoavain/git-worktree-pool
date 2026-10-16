import type { GitError } from "../core/errors.js";
import { WtpError } from "../core/errors.js";

const HINTS: [RegExp, string][] = [
    [/filename too long/i, "A path is too long for Windows. Run: git config --global core.longpaths true, then try again."],
    [/dubious ownership/i, "git does not trust this folder. Add it with the git config safe.directory command that git printed, then try again."]
];

export function explainGitError(e: GitError): WtpError {
    const hint = HINTS.find(([re]) => re.test(e.stderr))?.[1];
    return hint ? new WtpError(`${e.message}\n${hint}`, 3) : e;
}
