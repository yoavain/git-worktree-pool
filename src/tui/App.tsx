import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import { afterTeardown, failureText, type LifecycleFailure, type LifecycleResult, type LifecycleTarget } from "../cli/lifecycle.js";
import type { AssignResult } from "../core/assign.js";
import { takenBranches, type BranchChoice } from "../core/branch.js";
import { assertDeletable } from "../core/delete.js";
import { BranchInUseError } from "../core/errors.js";
import { assertFreeable, describeLoss, type SlotInspection } from "../core/free.js";
import type { LifecycleKey } from "../core/lifecycle.js";
import { chooseSlot, cloneRefusal, findSlot, type Pool, type SlotAction } from "../core/pool.js";
import type { CopyResult } from "../platform/clipboard.js";
import { stripAnsi } from "../ui/ansi.js";
import { SPINNER, TUI_GLYPHS } from "../ui/glyphs.js";
import { assignSummary, deletedText, freedText, slotTarget } from "../ui/labels.js";
import { buildRows, nextAssignHint, type Row } from "../ui/table.js";
import { AssignPopup } from "./AssignPopup.js";
import { Footer, KEYS_FILTER, KEYS_LIST, type KeyHint, type Message } from "./Footer.js";
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
  // expectBranch is set after a teardown: the branch the slot must still hold.
  free(index: number, opts: { expectBranch?: string | null }): Promise<void>;
  remove(index: number, opts: { deleteBranch: boolean; expectBranch?: string | null }): Promise<string[]>;
  listBranches(): Promise<BranchChoice[]>;
  copy(text: string): Promise<CopyResult>;
  lifecycle(key: LifecycleKey, target: LifecycleTarget, opts: { signal: AbortSignal; onStart(display: string): void }): Promise<LifecycleResult>;
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
  | { kind: "confirmDelete"; row: Row; lines: string[]; deleteBranch: boolean }
  | { kind: "script"; key: LifecycleKey; index: number; display: string; startedAt: number; abort: AbortController }
  // anyway: the free or delete that a failed teardown held back. null for setup.
  | { kind: "scriptFailed"; key: LifecycleKey; index: number; failure: LifecycleFailure; anyway: { verb: "free" | "delete"; run(): void } | null };

// The popup shows the end of the output, where npm ERR! and similar lines are.
const TAIL_LINES = 20;

// Modes with a popup show their keys in the popup, so the footer shows none.
const FOOTER_KEYS: Record<Mode["kind"], readonly KeyHint[]> = {
    list: KEYS_LIST,
    filter: KEYS_FILTER,
    help: [],
    working: [],
    assign: [],
    confirmCdFree: [],
    confirmFree: [],
    confirmDelete: [],
    script: [],
    scriptFailed: []
};

const verbing = (key: LifecycleKey) => (key === "setup" ? "setting up" : "tearing down");

function elapsed(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function progressText(mode: Extract<Mode, { kind: "script" }>, now: number, width: number): string {
    // Date.now() is wall-clock time and can step back, so clamp at zero.
    const ms = Math.max(0, now - mode.startedAt);
    const frame = SPINNER[Math.floor(ms / 100) % SPINNER.length];
    const text = `${frame} ${verbing(mode.key)} slot ${mode.index} · ${mode.display} · ${elapsed(ms)}`;
    return text.length < width ? text : `${text.slice(0, Math.max(0, width - 2))}…`;
}

function failureLines(key: LifecycleKey, f: LifecycleFailure): string[] {
    const tail = stripAnsi(f.tail).split(/\r?\n/).map((l) => l.trimEnd());
    while (tail.length && tail[tail.length - 1] === "") tail.pop();
    return [f.display, failureText(key, f), ...tail.slice(-TAIL_LINES)];
}

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

    // The progress line's spinner and clock.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (mode.kind !== "script") return;
        const timer = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(timer);
    }, [mode.kind]);

    // The progress line appears only once a script starts, so a repo without scripts sees nothing extra.
    async function runScript(key: LifecycleKey, target: LifecycleTarget, label: string): Promise<LifecycleResult> {
        const abort = new AbortController();
        setMode({ kind: "working", label });
        return actions.lifecycle(key, target, {
            signal: abort.signal,
            onStart: (display) => {
                // One timestamp: two Date.now() calls can straddle a millisecond and give a negative elapsed time.
                const startedAt = Date.now();
                setNow(startedAt);
                setMode({ kind: "script", key, index: target.index, display, startedAt, abort });
            }
        });
    }

    // Free and delete run the slot's teardown first. A failed one asks before the free or delete goes on;
    // Ctrl+C during it changes nothing else.
    // job gets the branch to re-check under the lock, and whether a teardown ran (for the error text).
    async function withTeardown(r: Row, verb: "free" | "delete", job: (expectBranch: string | null | undefined, ran: boolean) => void) {
        const slot = findSlot(pool, r.slotIndex!);
        if (!slot || slot.state !== "active") return job(undefined, false);
        try {
            if (verb === "free") assertFreeable(slot, slot.index, false);
            else assertDeletable(slot, slot.index, false);
            const label = `${verb === "free" ? "Freeing" : "Deleting"} slot ${slot.index}…`;
            const res = await runScript("teardown", { root: pool.ctx.root, index: slot.index, path: slot.path, branch: slot.branch }, label);
            if (res.status !== "failed") return job(slot.branch, res.status === "ok");
            if (res.interrupted) {
                setMode({ kind: "list" });
                setMessage({ tone: "info", text: `Teardown interrupted. Slot ${slot.index} was not ${verb === "free" ? "freed" : "deleted"}.` });
                return;
            }
            setMode({ kind: "scriptFailed", key: "teardown", index: slot.index, failure: res, anyway: { verb, run: () => job(slot.branch, true) } });
        }
        catch (e) {
            setMode({ kind: "list" });
            fail(e);
        }
    }

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
            const setup = await runScript("setup", { root: pool.ctx.root, index: r.index, path: r.path, branch: name }, `Assigning ${name}…`);
            if (setup.status === "failed") {
                // The slot stays assigned. The TUI stays open, also for "wtp assign", so the user sees why.
                const fresh = await actions.reload();
                setPool(fresh);
                selectSlot(fresh, r.index);
                setMessage(null);
                setMode({ kind: "scriptFailed", key: "setup", index: r.index, failure: setup, anyway: null });
                setPool(await actions.loadChanges(fresh));
                return;
            }
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
        // Ink's exitOnCtrlC is off, so a running script can be stopped without leaving the TUI.
        if (key.ctrl && input === "c") {
            if (mode.kind === "script") mode.abort.abort();
            else exit();
            return;
        }
        if (mode.kind === "working" || mode.kind === "script") return;

        if (mode.kind === "scriptFailed") {
            if (!mode.anyway) {
                setMode({ kind: "list" });
                setMessage({ tone: "info", text: `Press Enter to go to slot ${mode.index}.` });
            }
            else if (input === "y") mode.anyway.run();
            else if (input === "n" || key.escape) setMode({ kind: "list" });
            return;
        }

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
                void withTeardown(r, "free", (expectBranch, ran) => void run(`Freeing slot ${r.index}…`, () => afterTeardown(ran, async () => {
                    await actions.free(r.slotIndex!, { expectBranch });
                    if (r.isCurrent) setExitCd(pool.ctx.root);
                    return freedText(r.slotIndex!);
                })));
            }
            else if (input === "n" || key.escape) setMode({ kind: "list" });
            return;
        }

        if (mode.kind === "confirmDelete") {
            const { row: r, deleteBranch } = mode;
            if (input === " ") setMode({ ...mode, deleteBranch: !deleteBranch });
            else if (input === "y") {
                void withTeardown(r, "delete", (expectBranch, ran) => void run(`Deleting slot ${r.index}…`, () => afterTeardown(ran, async () => {
                    const warnings = await actions.remove(r.slotIndex!, { deleteBranch, expectBranch });
                    if (r.isCurrent) setExitCd(pool.ctx.root);
                    return [deletedText(r.slotIndex!, null), ...warnings].join(" ");
                })));
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
                <Text color="cyan" bold inverse>{" wtp "}</Text> <Text bold>{pool.ctx.repoName}</Text>  <Text dimColor>pool {pool.ctx.poolRoot}</Text>
            </Text>
            <PoolTable rows={rows} selected={selected} width={width} />
            {filter || mode.kind === "filter" ? <Text color="cyan">/{filter}{mode.kind === "filter" ? "▌" : ""}</Text> : null}
            <Text dimColor>{next}</Text>
            {mode.kind === "assign" ? (
                <AssignPopup query={mode.query} suggestions={suggestions} selected={mode.selected} target={slotTarget(chooseSlot(pool))} exits={opensAssign} />
            ) : null}
            {mode.kind === "confirmCdFree" ? (
                <Popup title={`Slot ${mode.row.index} is free`} tone="info" lines={["It has no branch. Go there anyway?"]} keys={[["y", "go there"], ["n", "cancel"]]} />
            ) : null}
            {mode.kind === "confirmFree" ? (
                <Popup title={`Free slot ${mode.row.index}?`} tone="warn" lines={[`${mode.row.folder} · ${mode.row.branch}`, ...mode.lines]} keys={[["y", "discard and free"], ["n", "cancel"]]} />
            ) : null}
            {mode.kind === "confirmDelete" ? (
                <Popup
                    title={`Delete slot ${mode.row.index}?`}
                    tone="danger"
                    lines={[`${mode.row.folder} · ${mode.row.branch}`, ...mode.lines]}
                    keys={[["y", "delete"], ["n", "cancel"]]}
                    checkbox={mode.row.tone === "active" ? { label: `also delete local branch ${mode.row.branch}`, checked: mode.deleteBranch } : undefined}
                />
            ) : null}
            {mode.kind === "scriptFailed" ? (
                <Popup
                    title={`${mode.key === "setup" ? "Setup" : "Teardown"} failed in slot ${mode.index}`}
                    tone="danger"
                    lines={failureLines(mode.key, mode.failure)}
                    keys={mode.anyway ? [["y", `${mode.anyway.verb} anyway`], ["n", "cancel"]] : [["any key", "close"]]}
                />
            ) : null}
            {mode.kind === "help" ? <Help /> : null}
            <Footer
                message={mode.kind === "working" ? { tone: "info", text: mode.label } : mode.kind === "script" ? { tone: "info", text: progressText(mode, now, width) } : message}
                keys={FOOTER_KEYS[mode.kind]}
            />
        </Box>
    );
}
