import path from "node:path";
import { chooseSlot, type Changes, type Pool, type Slot } from "../core/pool.js";
import { colors } from "./ansi.js";

export type RowTone = "root" | "active" | "free" | "broken" | "external";
export type Column = "index" | "branch" | "folder" | "changes" | "state";

export interface Row {
  index: string;
  branch: string;
  folder: string;
  changes: string;
  state: string;
  tone: RowTone;
  isCurrent: boolean;
  path: string;
  slotIndex: number | null;
}

const ALL: Column[] = ["index", "branch", "folder", "changes", "state"];
const HEAD: Record<Column, string> = { index: "#", branch: "BRANCH", folder: "FOLDER", changes: "CHANGES", state: "STATE" };
const GAP = 2;
const LEAD = 2;
const MIN_BRANCH = 8;

export function formatChanges(c: Changes | null | undefined, loading = ""): string {
    if (c === undefined) return loading;
    if (c === null) return "?";
    const parts: string[] = [];
    if (c.added || c.removed) parts.push(`+${c.added} -${c.removed}`);
    else if (c.changed) parts.push(`~${c.changed}`);
    if (c.untracked) parts.push(`?${c.untracked}`);
    if (c.ahead) parts.push(`↑${c.ahead}`);
    if (c.behind) parts.push(`↓${c.behind}`);
    return parts.length ? parts.join(" ") : "clean";
}

function branchLabel(s: Slot): string {
    if (s.state === "free" || (!s.branch && !s.head)) return "—";
    return s.branch ?? `(detached ${s.head!.slice(0, 7)})`;
}

function stateLabel(s: Slot): string {
    const base = s.state === "broken" ? `broken: ${s.problem ?? "unknown"}` : s.state;
    return s.locked ? `${base} locked` : base;
}

export function buildRows(pool: Pool, opts: { showCurrent?: boolean; loading?: string } = {}): Row[] {
    const showCurrent = opts.showCurrent ?? true;
    const base = path.dirname(pool.ctx.root);
    const here = (on: boolean) => (showCurrent && on ? " ● here" : "");
    const rows: Row[] = pool.slots.map((s) => ({
        index: String(s.index),
        branch: branchLabel(s),
        folder: path.relative(base, s.path),
        changes: s.state === "free" || s.state === "broken" ? "—" : formatChanges(s.changes, opts.loading ?? ""),
        state: stateLabel(s) + here(s.isCurrent),
        tone: s.state,
        isCurrent: s.isCurrent,
        path: s.path,
        slotIndex: s.index
    }));
    for (const x of pool.external) {
        rows.push({
            index: "-", branch: x.branch ?? "—", folder: path.relative(base, x.path), changes: "",
            state: "other" + here(x.isCurrent), tone: "external", isCurrent: x.isCurrent, path: x.path, slotIndex: null
        });
    }
    return rows;
}

export function truncateMiddle(s: string, width: number): string {
    if (s.length <= width) return s;
    const keep = Math.max(1, width - 1);
    const left = Math.ceil(keep / 2);
    return s.slice(0, left) + "…" + s.slice(s.length - (keep - left));
}

export function layoutColumns(rows: Row[], maxWidth?: number): { columns: Column[]; widths: Record<Column, number> } {
    const widths = {} as Record<Column, number>;
    for (const c of ALL) widths[c] = Math.max(HEAD[c].length, ...rows.map((r) => r[c].length));
    const total = (cols: Column[]) => LEAD + cols.reduce((n, c) => n + widths[c], 0) + GAP * (cols.length - 1);
    let columns = [...ALL];
    if (maxWidth !== undefined) {
        if (total(columns) > maxWidth) columns = columns.filter((c) => c !== "folder");
        if (total(columns) > maxWidth) columns = columns.filter((c) => c !== "changes");
        const over = total(columns) - maxWidth;
        if (over > 0) widths.branch = Math.max(MIN_BRANCH, widths.branch - over);
    }
    return { columns, widths };
}

export function formatTable(rows: Row[], opts: { color: boolean; width?: number }): string {
    const c = colors(opts.color);
    const { columns, widths } = layoutColumns(rows, opts.width);
    const cell = (col: Column, text: string, last: boolean) => {
        const t = truncateMiddle(text, widths[col]);
        return last ? t : t.padEnd(widths[col]);
    };
    const line = (values: Record<Column, string>, paint: (col: Column, s: string) => string) =>
        " ".repeat(LEAD) + columns.map((col, i) => paint(col, cell(col, values[col], i === columns.length - 1))).join(" ".repeat(GAP));

    const out = [line(HEAD, (_col, s) => c.dim(s))];
    for (const r of rows) {
        out.push(line(r, (col, s) => {
            if (col === "state" && r.tone === "free") return c.yellow(s);
            if (col === "state" && r.tone === "broken") return c.red(s);
            if (col === "state" && r.tone === "root") return c.blue(s);
            if (r.isCurrent && (col === "branch" || col === "state")) return c.cyan(s);
            if (col === "folder" || r.tone === "external") return c.dim(s);
            return s;
        }));
    }
    return out.join("\n");
}

export function nextAssignHint(pool: Pool): string {
    const next = chooseSlot(pool);
    return `next assign → slot ${next.index} (${next.reuse ? "free, reused" : "new"})`;
}
