import { Box, Text } from "ink";

const BORDER = { info: "cyan", warn: "yellow", danger: "red" } as const;

export function Popup(props: {
  title: string;
  tone: "info" | "warn" | "danger";
  lines: string[];
  keys: string;
  checkbox?: { label: string; checked: boolean };
}) {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor={BORDER[props.tone]} paddingX={1} marginTop={1}>
            <Text bold color={BORDER[props.tone]}>{props.title}</Text>
            {props.lines.map((l) => (
                <Text key={l}>{l}</Text>
            ))}
            {props.checkbox ? (
                <Text>
                    <Text color="cyan">{props.checkbox.checked ? "[x]" : "[ ]"}</Text> {props.checkbox.label} <Text dimColor>(space)</Text>
                </Text>
            ) : null}
            <Text dimColor>{props.keys}</Text>
        </Box>
    );
}
