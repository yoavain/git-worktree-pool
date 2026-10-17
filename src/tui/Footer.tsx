import { Box, Text } from "ink";
import { KeyHints, type KeyHint } from "./KeyHints.js";

export type { KeyHint };

export interface Message {
  tone: "ok" | "error" | "info";
  text: string;
}

export const KEYS_LIST: readonly KeyHint[] = [
    ["↑↓", "move"], ["⏎", "cd"], ["a", "assign"], ["f", "free"], ["d", "delete"],
    ["c", "copy"], ["/", "filter"], ["?", "help"], ["q", "quit"]
];
export const KEYS_FILTER: readonly KeyHint[] = [["⏎", "keep"], ["Esc", "clear"]];

const COLOR = { ok: "green", error: "red", info: "cyan" } as const;

export function Footer({ message, keys }: { message: Message | null; keys: readonly KeyHint[] }) {
    return (
        <Box flexDirection="column" marginTop={1}>
            {message ? <Text color={COLOR[message.tone]}>{message.text}</Text> : null}
            {keys.length ? <KeyHints keys={keys} /> : null}
        </Box>
    );
}
