import { Text } from "ink";

// A key and what it does.
export type KeyHint = readonly [key: string, label: string];

// The one look for key legends: the key in bold cyan, the label dim.
export function KeyHints({ keys, gap = 2 }: { keys: readonly KeyHint[]; gap?: number }) {
    return (
        <Text>
            {keys.map(([key, label], i) => (
                <Text key={key}>
                    {i > 0 ? " ".repeat(gap) : ""}
                    <Text bold color="cyan">{key}</Text>
                    <Text dimColor>{" " + label}</Text>
                </Text>
            ))}
        </Text>
    );
}
