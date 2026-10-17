import { Box, Text } from "ink";

const KEYS: [string, string][] = [
    ["↑ ↓  k j", "move the selection"],
    ["0-9", "jump to a slot index"],
    ["Enter", "cd to the slot and exit (copies the path)"],
    ["a", "assign a branch (Enter then goes there)"],
    ["f", "free the slot"],
    ["d", "delete the slot"],
    ["c", "copy the path"],
    ["/", "filter by branch"],
    ["?", "this help"],
    ["q  Esc", "quit (moves to the clone if you freed or deleted your slot)"]
];

export function Help() {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
            <Text bold color="cyan">Keys</Text>
            {KEYS.map(([k, v]) => (
                <Text key={k}>
                    <Text color="cyan">{k.padEnd(10)}</Text>
                    {v}
                </Text>
            ))}
            <Text dimColor>Press any key to go back.</Text>
        </Box>
    );
}
