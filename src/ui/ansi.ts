type Paint = (s: string) => string;

function wrap(open: number, close: number): Paint {
    return (s) => `\x1b[${open}m${s}\x1b[${close}m`;
}

const identity: Paint = (s) => s;

// CSI sequences (colours, cursor moves) and OSC sequences (titles, links), as npm and git print them.
// Built from a string, because a control character in a regex literal trips no-control-regex.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_RE = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\))`, "g");

export function stripAnsi(s: string): string {
    return s.replace(ANSI_RE, "");
}

export function colors(on: boolean): Record<"dim" | "bold" | "red" | "green" | "yellow" | "cyan" | "blue", Paint> {
    if (!on) return { dim: identity, bold: identity, red: identity, green: identity, yellow: identity, cyan: identity, blue: identity };
    return {
        dim: wrap(2, 22),
        bold: wrap(1, 22),
        red: wrap(31, 39),
        green: wrap(32, 39),
        yellow: wrap(33, 39),
        cyan: wrap(36, 39),
        blue: wrap(34, 39)
    };
}
