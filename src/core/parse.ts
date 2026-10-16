export interface WorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

export function parseWorktreeList(out: string): WorktreeEntry[] {
    const entries: WorktreeEntry[] = [];
    let cur: WorktreeEntry | null = null;
    for (const raw of out.split("\n")) {
        const line = raw.replace(/\r$/, "");
        if (line.startsWith("worktree ")) {
            cur = { path: line.slice("worktree ".length), head: null, branch: null, detached: false, bare: false, locked: false, prunable: false };
            entries.push(cur);
            continue;
        }
        if (!cur || line === "") continue;
        if (line.startsWith("HEAD ")) cur.head = line.slice(5);
        else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
        else if (line === "detached") cur.detached = true;
        else if (line === "bare") cur.bare = true;
        else if (line === "locked" || line.startsWith("locked ")) cur.locked = true;
        else if (line === "prunable" || line.startsWith("prunable ")) cur.prunable = true;
    }
    return entries;
}

export interface StatusSummary {
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changed: number;
  untracked: number;
}

export function parseStatusV2(out: string): StatusSummary {
    const s: StatusSummary = { head: null, upstream: null, ahead: 0, behind: 0, changed: 0, untracked: 0 };
    for (const raw of out.split("\n")) {
        const line = raw.replace(/\r$/, "");
        if (line.startsWith("# branch.head ")) {
            const head = line.slice("# branch.head ".length);
            s.head = head === "(detached)" ? null : head;
        }
        else if (line.startsWith("# branch.upstream ")) {
            s.upstream = line.slice("# branch.upstream ".length);
        }
        else if (line.startsWith("# branch.ab ")) {
            const m = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
            if (m) {
                s.ahead = Number(m[1]);
                s.behind = Number(m[2]);
            }
        }
        else if (/^[12u] /.test(line)) {
            s.changed++;
        }
        else if (line.startsWith("? ")) {
            s.untracked++;
        }
    }
    return s;
}

export function parseNumstat(out: string): { added: number; removed: number } {
    let added = 0;
    let removed = 0;
    for (const line of out.split("\n")) {
        const m = /^(\d+|-)\t(\d+|-)\t/.exec(line);
        if (!m) continue;
        if (m[1] !== "-") added += Number(m[1]);
        if (m[2] !== "-") removed += Number(m[2]);
    }
    return { added, removed };
}
