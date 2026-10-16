type Paint = (s: string) => string;

function wrap(open: number, close: number): Paint {
    return (s) => `\x1b[${open}m${s}\x1b[${close}m`;
}

const identity: Paint = (s) => s;

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
