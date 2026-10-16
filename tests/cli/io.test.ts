import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { askYesNo } from "../../src/cli/io.js";

function streams() {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = "";
    output.on("data", (d: Buffer) => {
        written += d.toString();
    });
    return { input, output, terminal: true, written: () => written };
}

describe("askYesNo", () => {
    it("accepts y and yes, and nothing else", async () => {
        for (const [typed, expected] of [["y", true], ["Yes", true], ["n", false], ["", false]] as const) {
            const s = streams();
            const answer = askYesNo("Free?", s);
            s.input.write(`${typed}\r`);
            expect(await answer).toBe(expected);
        }
    });

    it("treats Ctrl+C as no, instead of leaving the question open", async () => {
        const s = streams();
        const answer = askYesNo("Free?", s);
        s.input.write("\x03");
        expect(await answer).toBe(false);
    }, 2_000);

    it("treats a closed input as no", async () => {
        const s = streams();
        const answer = askYesNo("Free?", s);
        s.input.end();
        expect(await answer).toBe(false);
    }, 2_000);

    it("shows the question with the default", async () => {
        const s = streams();
        const answer = askYesNo("Free?", s);
        s.input.write("n\r");
        await answer;
        expect(s.written()).toContain("Free? [y/N] ");
    });
});
