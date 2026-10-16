import { Box, Text } from "ink";

export interface Message {
  tone: "ok" | "error" | "info";
  text: string;
}

export const KEYS_LIST = "↑↓ move  ⏎ cd  a assign  f free  d delete  c copy  / filter  r refresh  ? help  q quit";

const COLOR = { ok: "green", error: "red", info: "cyan" } as const;

export function Footer({ message, keys }: { message: Message | null; keys: string }) {
    return (
        <Box flexDirection="column" marginTop={1}>
            {message ? <Text color={COLOR[message.tone]}>{message.text}</Text> : null}
            <Text dimColor>{keys}</Text>
        </Box>
    );
}
