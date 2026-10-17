import { Box, Text } from "ink";
import { layoutColumns, truncateMiddle, type Column, type Row } from "../ui/table.js";

const HEADER: Record<Column, string> = { index: "#", branch: "BRANCH", folder: "FOLDER", changes: "CHANGES", state: "STATE" };
const LEAD = 2;
const GAP = 2;
// The round border and one column of padding on each side.
const FRAME_WIDTH = 4;

// The root row has no color: the terminal's dark blue is hard to read on a black background.
export function toneColor(r: Row): string | undefined {
    if (r.tone === "free") return "yellow";
    if (r.tone === "broken") return "red";
    if (r.tone === "external") return "gray";
    if (r.isCurrent) return "cyan";
    return undefined;
}

export function PoolTable({ rows, selected, width }: { rows: Row[]; selected: number; width: number }) {
    const { columns, widths } = layoutColumns(rows, Math.max(20, width - 2 - FRAME_WIDTH));
    const cell = (values: Record<Column, string>, c: Column, i: number) => {
        const t = truncateMiddle(values[c], widths[c]);
        return i === columns.length - 1 ? t : t.padEnd(widths[c]);
    };
    const ruleWidth = LEAD + columns.reduce((n, c) => n + widths[c], 0) + GAP * (columns.length - 1);

    return (
        // flex-start: the frame fits the table instead of stretching to the terminal width.
        <Box flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor="gray" paddingX={1}>
            <Text bold>{" ".repeat(LEAD) + columns.map((c, i) => cell(HEADER, c, i)).join(" ".repeat(GAP))}</Text>
            <Text color="gray" dimColor>{"─".repeat(ruleWidth)}</Text>
            {rows.map((r, i) => (
                <Text key={r.path} color={toneColor(r)} bold={i === selected} inverse={i === selected}>
                    {i === selected ? "▶ " : "  "}
                    {columns.map((c, ci) => (
                        // Not on the selected row: dim ends with SGR 22, which also ends its bold.
                        <Text key={c} dimColor={c === "folder" && i !== selected}>
                            {(ci === 0 ? "" : " ".repeat(GAP)) + cell(r, c, ci)}
                        </Text>
                    ))}
                </Text>
            ))}
        </Box>
    );
}
