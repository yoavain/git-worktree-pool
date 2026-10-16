import { describe, expect, it } from "vitest";
import { clipboardCandidates, copyToClipboard, osc52 } from "../../src/platform/clipboard.js";

describe("clipboardCandidates", () => {
    it("uses clip.exe with UTF-16LE and no byte order mark on Windows", () => {
        const [c] = clipboardCandidates("win32", {});
        expect(c?.cmd).toBe("clip.exe");
        const bytes = c!.encode("C:ü");
        expect([...bytes]).toEqual([0x43, 0x00, 0x3a, 0x00, 0xfc, 0x00]);
    });

    it("uses pbcopy on macOS", () => {
        expect(clipboardCandidates("darwin", {}).map((c) => c.cmd)).toEqual(["pbcopy"]);
    });

    it("tries wl-copy first on Wayland, then xclip and xsel", () => {
        expect(clipboardCandidates("linux", { WAYLAND_DISPLAY: "wayland-0" }).map((c) => c.cmd)).toEqual(["wl-copy", "xclip", "xsel"]);
        expect(clipboardCandidates("linux", {}).map((c) => c.cmd)).toEqual(["xclip", "xsel"]);
    });
});

describe("copyToClipboard", () => {
    it("stops at the first command that works", async () => {
        const calls: string[] = [];
        const run = async (cmd: string) => {
            calls.push(cmd);
            return cmd === "xclip";
        };
        expect(await copyToClipboard("x", { platform: "linux", env: {}, run })).toBe("native");
        expect(calls).toEqual(["xclip"]);
    });

    it("falls back to OSC 52 when no command works", async () => {
        let written = "";
        const result = await copyToClipboard("C:\\dir with space ü", {
            platform: "linux", env: {}, run: async () => false, writeTty: (s) => {
                written += s;
            }
        });
        expect(result).toBe("osc52");
        expect(written).toBe(osc52("C:\\dir with space ü"));
        expect(written.startsWith("\x1b]52;c;")).toBe(true);
    });

    it("reports failure when there is no terminal either", async () => {
        expect(await copyToClipboard("x", { platform: "linux", env: {}, run: async () => false })).toBe("failed");
    });
});
