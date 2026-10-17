import { Box, Text } from "ink";
import type { Suggestion } from "./fuzzy.js";
import { KeyHints } from "./KeyHints.js";

const SOURCE: Record<Suggestion["source"], { label: string; color: string }> = {
    local: { label: "local", color: "blue" },
    remote: { label: "origin", color: "yellow" },
    new: { label: "new", color: "green" }
};

export function AssignPopup(props: { query: string; suggestions: Suggestion[]; selected: number; target: string; exits: boolean }) {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
            <Text bold color="cyan">Assign a worktree</Text>
            <Text>
                <Text dimColor>Branch</Text>  {props.query}<Text inverse> </Text>
            </Text>
            <Text> </Text>
            {props.suggestions.map((s, i) => (
                <Text key={`${s.source}:${s.name}`} inverse={i === props.selected}>
                    {i === props.selected ? "▶ " : "  "}
                    {s.source === "new" ? <Text color="green">+ new branch "{s.name}"</Text> : s.name}
                    {"  "}
                    <Text color={SOURCE[s.source].color}>{SOURCE[s.source].label}</Text>
                </Text>
            ))}
            <Text> </Text>
            <Text dimColor>Target  {props.target}</Text>
            <KeyHints keys={[["⏎", props.exits ? "assign + cd" : "assign"], ["⇥", "complete"], ["↑↓", "choose"], ["Esc", "cancel"]]} />
        </Box>
    );
}
