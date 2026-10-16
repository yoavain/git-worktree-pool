import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Io } from "../../src/cli/io.js";

export interface FakeIo {
  io: Io;
  out(): string;
  err(): string;
  copies: string[];
  questions: string[];
  cwdTarget(): Promise<string>;
}

export function makeIo(cwd: string, opts: {
  env?: NodeJS.ProcessEnv; tty?: boolean; columns?: number;
  answer?: boolean; integration?: boolean; platform?: NodeJS.Platform; home?: string;
} = {}): FakeIo {
    let out = "";
    let err = "";
    const copies: string[] = [];
    const questions: string[] = [];
    const cwdFile = path.join(mkdtempSync(path.join(os.tmpdir(), "wtp-io-")), "cwd");
    const env: NodeJS.ProcessEnv = { ...(opts.env ?? {}) };
    if (opts.integration ?? true) env.WTP_CWD_FILE = cwdFile;
    const io: Io = {
        cwd,
        env,
        platform: opts.platform ?? process.platform,
        home: opts.home ?? os.tmpdir(),
        stdout: { write: (s: string) => {
            out += s;
            return true;
        }, isTTY: opts.tty ?? false, columns: opts.columns },
        stderr: { write: (s: string) => {
            err += s;
            return true;
        } },
        stdinIsTTY: opts.tty ?? false,
        async confirm(question) {
            questions.push(question);
            return opts.answer ?? false;
        },
        async copy(text) {
            copies.push(text);
            return "native";
        }
    };
    return {
        io, copies, questions,
        out: () => out,
        err: () => err,
        cwdTarget: async () => readFile(cwdFile, "utf8").catch(() => "")
    };
}
