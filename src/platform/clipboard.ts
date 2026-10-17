import { spawn } from "node:child_process";

export type CopyResult = "native" | "osc52" | "failed";
// Feeds input to a command's stdin and reports whether it exited 0.
export type InputRunner = (cmd: string, args: string[], input: Buffer) => Promise<boolean>;

interface Candidate {
  cmd: string;
  args: string[];
  encode(text: string): Buffer;
}

const utf8 = (text: string) => Buffer.from(text, "utf8");
// clip.exe detects UTF-16LE without a BOM, and keeps a BOM as a U+FEFF char in the clipboard.
const utf16 = (text: string) => Buffer.from(text, "utf16le");

export const runWithInput: InputRunner = (cmd, args, input) =>
    new Promise((resolve) => {
        const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
        child.stdin.on("error", () => resolve(false));
        child.stdin.end(input);
    });

export function clipboardCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Candidate[] {
    if (platform === "win32") return [{ cmd: "clip.exe", args: [], encode: utf16 }];
    if (platform === "darwin") return [{ cmd: "pbcopy", args: [], encode: utf8 }];
    const list: Candidate[] = [];
    if (env.WAYLAND_DISPLAY) list.push({ cmd: "wl-copy", args: [], encode: utf8 });
    list.push({ cmd: "xclip", args: ["-selection", "clipboard"], encode: utf8 });
    list.push({ cmd: "xsel", args: ["--clipboard", "--input"], encode: utf8 });
    return list;
}

export function osc52(text: string): string {
    return `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`;
}

export async function copyToClipboard(
    text: string,
    deps: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; run?: InputRunner; writeTty?: (s: string) => void }
): Promise<CopyResult> {
    const run = deps.run ?? runWithInput;
    for (const c of clipboardCandidates(deps.platform, deps.env)) {
        if (await run(c.cmd, c.args, c.encode(text))) return "native";
    }
    if (deps.writeTty) {
        deps.writeTty(osc52(text));
        return "osc52";
    }
    return "failed";
}
