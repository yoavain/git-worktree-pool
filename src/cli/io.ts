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
  confirm(question: string, opts?: AskOptions): Promise<boolean>;
  copy(text: string): Promise<CopyResult>;
}

export interface AskOptions {
    // Enter alone means yes. For prompts where yes is why the user ran the command; never for a discard.
    defaultYes?: boolean;
}

export interface AskStreams {
    input: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
    terminal?: boolean;
}

// Ctrl+C and a closed input both mean no. Without the SIGINT listener, readline only pauses the
// input, the question never answers, and node exits with "unsettled top-level await".
export function askYesNo(question: string, streams: AskStreams, opts: AskOptions = {}): Promise<boolean> {
    const rl = createInterface({ input: streams.input, output: streams.output, terminal: streams.terminal });
    return new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (yes: boolean) => {
            if (done) return;
            done = true;
            rl.close();
            resolve(yes);
        };
        rl.on("SIGINT", () => {
            streams.output.write("\n");
            finish(false);
        });
        rl.on("close", () => finish(false));
        const hint = opts.defaultYes ? "[Y/n]" : "[y/N]";
        rl.question(`${question} ${hint} `, (answer) => {
            const a = answer.trim();
            finish(a === "" ? Boolean(opts.defaultYes) : /^y(es)?$/i.test(a));
        });
    });
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
        async confirm(question, opts) {
            if (!process.stdin.isTTY) throw new UserError("This needs confirmation. Run it in a terminal, or pass --yes.");
            return askYesNo(question, { input: process.stdin, output: process.stderr }, opts);
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
