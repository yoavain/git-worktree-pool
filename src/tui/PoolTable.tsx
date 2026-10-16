import { Box, Text } from "ink";
import { layoutColumns, truncateMiddle, type Column, type Row } from "../ui/table.js";

const HEADER: Record<Column, string> = { index: "#", branch: "BRANCH", folder: "FOLDER", changes: "CHANGES", state: "STATE" };

function toneColor(r: Row): string | undefined {
    if (r.tone === "free") return "yellow";
    if (r.tone === "broken") return "red";
    if (r.tone === "external") return "gray";
    if (r.isCurrent) return "cyan";
    if (r.tone === "root") return "blue";
    return undefined;
}

export function PoolTable({ rows, selected, width }: { rows: Row[]; selected: number; width: number }) {
    const { columns, widths } = layoutColumns(rows, Math.max(20, width - 2));
    const line = (values: Record<Column, string>) =>
        columns
            .map((c, i) => {
                const t = truncateMiddle(values[c], widths[c]);
                return i === columns.length - 1 ? t : t.padEnd(widths[c]);
            })
            .join("  ");

    return (
        <Box flexDirection="column">
            <Text dimColor>{"  " + line(HEADER)}</Text>
            {rows.map((r, i) => (
                <Text key={r.path} color={toneColor(r)} bold={i === selected} inverse={i === selected}>
                    {(i === selected ? "▶ " : "  ") + line(r)}
                </Text>
            ))}
        </Box>
    );
}
