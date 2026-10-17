import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssignResult } from "../core/assign.js";
import { takenBranches, type BranchChoice } from "../core/branch.js";
import { BranchInUseError } from "../core/errors.js";
import { describeLoss, type SlotInspection } from "../core/free.js";
import { chooseSlot, cloneRefusal, type Pool, type SlotAction } from "../core/pool.js";
import type { CopyResult } from "../platform/clipboard.js";
import { TUI_GLYPHS } from "../ui/glyphs.js";
import { assignSummary, deletedText, freedText, slotTarget } from "../ui/labels.js";
import { buildRows, nextAssignHint, type Row } from "../ui/table.js";
import { AssignPopup } from "./AssignPopup.js";
import { Footer, KEYS_LIST, type Message } from "./Footer.js";
import { suggestBranches } from "./fuzzy.js";
import { Help } from "./Help.js";
import { PoolTable } from "./PoolTable.js";
import { Popup } from "./Popup.js";
import { createDigitBuffer, initialSelection, moveSelection, visibleRows } from "./state.js";

export interface TuiActions {
  reload(): Promise<Pool>;
  loadChanges(pool: Pool): Promise<Pool>;
  assign(branch: string): Promise<AssignResult>;
  inspect(index: number): Promise<SlotInspection>;
  free(index: number): Promise<void>;
  remove(index: number, opts: { deleteBranch: boolean }): Promise<string[]>;
  listBranches(): Promise<BranchChoice[]>;
  copy(text: string): Promise<CopyResult>;
}

export interface TuiResult {
  cd: string | null;
  copied: boolean;
  /** Lines to print after the TUI exits, such as a fetch warning from assign. */
  notes?: string[];
}

export interface AppProps {
  initialPool: Pool;
  actions: TuiActions;
  initialMode?: "list" | "assign";
  platform: NodeJS.Platform;
  onExit(result: TuiResult): void;
}

type Mode =
  | { kind: "list" }
  | { kind: "filter" }
  | { kind: "help" }
  | { kind: "working"; label: string }
  | { kind: "assign"; query: string; selected: number }
  | { kind: "confirmCdFree"; row: Row }
  | { kind: "confirmFree"; row: Row; lines: string[] }
  | { kind: "confirmDelete"; row: Row; lines: string[]; deleteBranch: boolean };

const FOOTER_KEYS: Record<Mode["kind"], string> = {
    list: KEYS_LIST,
    filter: "type to filter  ⏎ keep  Esc clear",
    help: "",
    working: "",
    assign: "",
    confirmCdFree: "",
    confirmFree: "",
    confirmDelete: ""
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App({ initialPool, actions, initialMode = "list", platform, onExit }: AppProps) {
    const { exit } = useApp();
    const opensAssign = initialMode === "assign";
    const { stdout } = useStdout();
    const width = stdout?.columns ?? 100;

    const [pool, setPool] = useState(initialPool);
    const [filter, setFilter] = useState("");
    const [mode, setMode] = useState<Mode>(initialMode === "assign" ? { kind: "assign", query: "", selected: 0 } : { kind: "list" });
    const [message, setMessage] = useState<Message | null>(null);
    const [branches, setBranches] = useState<BranchChoice[]>([]);
    const [exitCd, setExitCd] = useState<string | null>(null);
    const rows = useMemo(() => visibleRows(buildRows(pool, { loading: "…", glyphs: TUI_GLYPHS }), filter), [pool, filter]);
    const taken = useMemo(() => takenBranches(pool), [pool]);
    const [selected, setSelected] = useState(() => initialSelection(rows));
    const digits = useRef(createDigitBuffer());
    const row: Row | undefined = rows[selected];

    const fail = (e: unknown) => setMessage({ tone: "error", text: errorText(e) });
    const finish = (cd: string | null, copied: boolean, notes?: string[]) => {
        onExit(notes ? { cd, copied, notes } : { cd, copied });
        exit();
    };

    async function loadBranches() {
        try {
            setBranches(await actions.listBranches());
        }
        catch (e) {
            fail(e);
        }
    }

    async function reload() {
        const fresh = await actions.reload();
        setPool(fresh);
        setPool(await actions.loadChanges(fresh));
    }

    useEffect(() => {
        actions.loadChanges(initialPool).then(setPool, fail);
        if (initialMode === "assign") void loadBranches();
    }, []);

    useEffect(() => {
        setSelected((s) => moveSelection(s, 0, rows.length));
    }, [rows.length]);

    async function run(label: string, job: () => Promise<string>) {
        setMode({ kind: "working", label });
        try {
            const text = await job();
            setMode({ kind: "list" });
            setMessage({ tone: "ok", text });
            await reload();
        }
        catch (e) {
            setMode({ kind: "list" });
            fail(e);
        }
    }

    async function enter(r: Row, confirmed = false) {
        if (r.tone === "broken") {
            setMessage({ tone: "error", text: `Slot ${r.index} is broken. Run wtp doctor.` });
            return;
        }
        if (r.tone === "free" && !confirmed) {
            setMode({ kind: "confirmCdFree", row: r });
            return;
        }
        await actions.copy(r.path);
        finish(r.path, true);
    }

    function refusal(r: Row, verb: SlotAction): string | null {
        if (r.slotIndex === null) return `wtp only ${verb}s pool slots. This worktree is outside the pool.`;
        if (r.slotIndex === 0) return cloneRefusal(verb);
        if (r.tone === "broken") return `Slot ${r.index} is broken. Run wtp doctor.`;
        return null;
    }

    async function startFree(r: Row) {
        const no = refusal(r, "free");
        if (no) return setMessage({ tone: "error", text: no });
        if (r.tone === "free") return setMessage({ tone: "info", text: `Slot ${r.index} is already free.` });
        try {
            const lines = describeLoss(await actions.inspect(r.slotIndex!));
            if (r.isCurrent) lines.push("You are in this slot. wtp moves you to the root when you quit.");
            setMode({ kind: "confirmFree", row: r, lines });
        }
        catch (e) {
            fail(e);
        }
    }

    async function startDelete(r: Row) {
        const no = refusal(r, "delete");
        if (no) return setMessage({ tone: "error", text: no });
        if (r.isCurrent && platform === "win32") {
            return setMessage({ tone: "error", text: `You are in slot ${r.index}. Windows can't delete it while your shell is there. Press 0, Enter, then run wtp again.` });
        }
        try {
            const lines = r.tone === "active" ? describeLoss(await actions.inspect(r.slotIndex!)).slice(0, -1) : [];
            lines.push("The folder is removed from disk.");
            setMode({ kind: "confirmDelete", row: r, lines, deleteBranch: false });
        }
        catch (e) {
            fail(e);
        }
    }

    // Clears the filter and selects the row of the slot, so the next Enter goes there.
    function selectSlot(p: Pool, index: number) {
        setFilter("");
        const i = buildRows(p, { loading: "…", glyphs: TUI_GLYPHS }).findIndex((x) => x.slotIndex === index);
        if (i >= 0) setSelected(i);
    }

    async function submitAssign(name: string, back: Mode) {
        if (!name) return;
        setMode({ kind: "working", label: `Assigning ${name}…` });
        try {
            const r = await actions.assign(name);
            const notes = [
                ...(r.createdPoolRoot ? [`created the pool folder ${pool.ctx.poolRoot}`] : []),
                ...r.warnings.map((w) => `! ${w}`),
                assignSummary(name, r, TUI_GLYPHS)
            ];
            // "wtp assign" asked for one assign, so it exits into the slot. In the list only Enter, q, and Esc exit.
            if (opensAssign) {
                await actions.copy(r.path);
                finish(r.path, true, notes);
                return;
            }
            const fresh = await actions.reload();
            setPool(fresh);
            selectSlot(fresh, r.index);
            setMode({ kind: "list" });
            setMessage({ tone: r.warnings.length ? "info" : "ok", text: `${notes.join(" ")}. Press Enter to go there.` });
            setPool(await actions.loadChanges(fresh));
        }
        catch (e) {
            if (e instanceof BranchInUseError && e.index !== null) {
                setMode({ kind: "list" });
                selectSlot(pool, e.index);
                setMessage({ tone: "info", text: `${name} is already in slot ${e.index}. Press Enter to go there.` });
            }
            else {
                setMode(back);
                fail(e);
            }
        }
    }

    useInput((input, key) => {
        if (mode.kind === "working") return;

        if (mode.kind === "help") {
            setMode({ kind: "list" });
            return;
        }

        if (mode.kind === "filter") {
            if (key.escape) {
                setFilter("");
                setMode({ kind: "list" });
            }
            else if (key.return) setMode({ kind: "list" });
            else if (key.backspace || key.delete) setFilter((f) => f.slice(0, -1));
            else if (input && !key.ctrl && !key.meta) {
                setFilter((f) => f + input);
                setSelected(0);
            }
            return;
        }

        if (mode.kind === "assign") {
            const suggestions = suggestBranches(mode.query, branches, { taken });
            if (key.escape) setMode({ kind: "list" });
            else if (key.return) void submitAssign(suggestions[mode.selected]?.name ?? mode.query.trim(), mode);
            else if (key.upArrow) setMode({ ...mode, selected: moveSelection(mode.selected, -1, suggestions.length) });
            else if (key.downArrow) setMode({ ...mode, selected: moveSelection(mode.selected, 1, suggestions.length) });
            else if (key.tab) {
                const s = suggestions[mode.selected];
                if (s) setMode({ kind: "assign", query: s.name, selected: 0 });
            }
            else if (key.backspace || key.delete) setMode({ kind: "assign", query: mode.query.slice(0, -1), selected: 0 });
            else if (input && !key.ctrl && !key.meta) setMode({ kind: "assign", query: mode.query + input, selected: 0 });
            return;
        }

        if (mode.kind === "confirmCdFree") {
            if (input === "y") void enter(mode.row, true);
            else if (input === "n" || key.escape) setMode({ kind: "list" });
            return;
        }

        if (mode.kind === "confirmFree") {
            const r = mode.row;
            if (input === "y") {
                void run(`Freeing slot ${r.index}…`, async () => {
                    await actions.free(r.slotIndex!);
                    if (r.isCurrent) setExitCd(pool.ctx.root);
                    return freedText(r.slotIndex!);
                });
            }
            else if (input === "n" || key.escape) setMode({ kind: "list" });
            return;
        }

        if (mode.kind === "confirmDelete") {
            const { row: r, deleteBranch } = mode;
            if (input === " ") setMode({ ...mode, deleteBranch: !deleteBranch });
            else if (input === "y") {
                void run(`Deleting slot ${r.index}…`, async () => {
                    const warnings = await actions.remove(r.slotIndex!, { deleteBranch });
                    if (r.isCurrent) setExitCd(pool.ctx.root);
                    return [deletedText(r.slotIndex!, null), ...warnings].join(" ");
                });
            }
            else if (input === "n" || key.escape) setMode({ kind: "list" });
            return;
        }

        if (key.upArrow || input === "k") setSelected((s) => moveSelection(s, -1, rows.length));
        else if (key.downArrow || input === "j") setSelected((s) => moveSelection(s, 1, rows.length));
        else if (key.return) {
            if (row) void enter(row);
        }
        else if (input === "q" || key.escape) finish(exitCd, false);
        else if (/^[0-9]$/.test(input)) {
            const i = digits.current.push(input, Date.now(), rows);
            if (i !== null) setSelected(i);
        }
        else if (input === "a") {
            setMode({ kind: "assign", query: "", selected: 0 });
            void loadBranches();
        }
        else if (input === "f") {
            if (row) void startFree(row);
        }
        else if (input === "d") {
            if (row) void startDelete(row);
        }
        else if (input === "c") {
            if (row) {
                void actions.copy(row.path).then((res) =>
                    setMessage(res === "failed"
                        ? { tone: "error", text: `Could not copy. Path: ${row.path}` }
                        : { tone: "ok", text: `✓ copied ${row.path}` }));
            }
        }
        else if (input === "/") setMode({ kind: "filter" });
        else if (input === "?") setMode({ kind: "help" });
    });

    const next = nextAssignHint(pool, TUI_GLYPHS);
    const suggestions = mode.kind === "assign" ? suggestBranches(mode.query, branches, { taken }) : [];

    return (
        <Box flexDirection="column">
            <Text>
                <Text color="cyan" bold>wtp</Text>  <Text bold>{pool.ctx.repoName}</Text>  <Text dimColor>pool {pool.ctx.poolRoot}</Text>
            </Text>
            <PoolTable rows={rows} selected={selected} width={width} />
            {filter || mode.kind === "filter" ? <Text color="cyan">/{filter}{mode.kind === "filter" ? "▌" : ""}</Text> : null}
            <Text dimColor>{next}</Text>
            {mode.kind === "assign" ? (
                <AssignPopup query={mode.query} suggestions={suggestions} selected={mode.selected} target={slotTarget(chooseSlot(pool))} exits={opensAssign} />
            ) : null}
            {mode.kind === "confirmCdFree" ? (
                <Popup title={`Slot ${mode.row.index} is free`} tone="info" lines={["It has no branch. Go there anyway?"]} keys="y go there    n cancel" />
            ) : null}
            {mode.kind === "confirmFree" ? (
                <Popup title={`Free slot ${mode.row.index}?`} tone="warn" lines={[`${mode.row.folder} · ${mode.row.branch}`, ...mode.lines]} keys="y discard and free    n cancel" />
            ) : null}
            {mode.kind === "confirmDelete" ? (
                <Popup
                    title={`Delete slot ${mode.row.index}?`}
                    tone="danger"
                    lines={[`${mode.row.folder} · ${mode.row.branch}`, ...mode.lines]}
                    keys="y delete    n cancel"
                    checkbox={mode.row.tone === "active" ? { label: `also delete local branch ${mode.row.branch}`, checked: mode.deleteBranch } : undefined}
                />
            ) : null}
            {mode.kind === "help" ? <Help /> : null}
            <Footer message={mode.kind === "working" ? { tone: "info", text: mode.label } : message} keys={FOOTER_KEYS[mode.kind]} />
        </Box>
    );
}
