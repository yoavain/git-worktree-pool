import os from "node:os";
// The callback API: readline/promises is still experimental below Node 22.17, and engines allows 22.12.
import { createInterface } from "node:readline";
import { UserError } from "../core/errors.js";
import { copyToClipboard, type CopyResult } from "../platform/clipboard.js";

export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  stdout: { write(s: string): unknown; isTTY?: boolean; columns?: number };
  stderr: { write(s: string): unknown };
  stdinIsTTY: boolean;
  confirm(question: string): Promise<boolean>;
  copy(text: string): Promise<CopyResult>;
}

export function defaultIo(): Io {
    return {
        cwd: process.cwd(),
        env: process.env,
        platform: process.platform,
        home: os.homedir(),
        stdout: process.stdout,
        stderr: process.stderr,
        stdinIsTTY: Boolean(process.stdin.isTTY),
        async confirm(question) {
            if (!process.stdin.isTTY) throw new UserError("This needs confirmation. Run it in a terminal, or pass --yes.");
            const rl = createInterface({ input: process.stdin, output: process.stderr });
            try {
                const answer = await new Promise<string>((resolve) => rl.question(`${question} [y/N] `, resolve));
                return /^y(es)?$/i.test(answer.trim());
            }
            finally {
                rl.close();
            }
        },
        copy(text) {
            return copyToClipboard(text, {
                platform: process.platform,
                env: process.env,
                writeTty: process.stderr.isTTY ? (s) => {
                    process.stderr.write(s);
                } : undefined
            });
        }
    };
}
