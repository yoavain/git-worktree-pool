import { execFile } from "node:child_process";

// Runs a command and resolves with its stdout. Tests pass a fake one.
export type OutputRunner = (cmd: string, args: string[]) => Promise<string>;

export function runForOutput(opts: { env?: NodeJS.ProcessEnv; maxBuffer?: number } = {}): OutputRunner {
    return (cmd, args) =>
        new Promise((resolve, reject) => {
            execFile(cmd, args, { windowsHide: true, encoding: "utf8", ...opts }, (err, stdout) => {
                if (err) reject(err);
                else resolve(stdout);
            });
        });
}
