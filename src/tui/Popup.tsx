import { Box, Text } from "ink";
import { KeyHints, type KeyHint } from "./KeyHints.js";

const BORDER = { info: "cyan", warn: "yellow", danger: "red" } as const;

export function Popup(props: {
  title: string;
  tone: "info" | "warn" | "danger";
  lines: string[];
  keys: readonly KeyHint[];
  checkbox?: { label: string; checked: boolean };
}) {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor={BORDER[props.tone]} paddingX={1} marginTop={1}>
            <Text bold color={BORDER[props.tone]}>{props.title}</Text>
            {/* Script output can repeat a line, so the key includes the position. */}
            {props.lines.map((l, i) => (
                <Text key={`${i}:${l}`}>{l}</Text>
            ))}
            {props.checkbox ? (
                <Text>
                    <Text color="cyan">{props.checkbox.checked ? "[x]" : "[ ]"}</Text> {props.checkbox.label} <Text dimColor>(space)</Text>
                </Text>
            ) : null}
            {/* Four spaces, not two: a confirm has only two choices, and they must not run together. */}
            <KeyHints keys={props.keys} gap={4} />
        </Box>
    );
}
