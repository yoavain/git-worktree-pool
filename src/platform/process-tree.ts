import { runForOutput, type OutputRunner } from "./run.js";

export interface ProcInfo {
  pid: number;
  ppid: number;
  exe: string;
}

// One query for all processes is faster than one query per parent. UTF-8 keeps non-ASCII paths exact.
export const PROCESS_QUERY =
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
  "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)|$($_.ParentProcessId)|$($_.ExecutablePath)\" }";

export function parseProcessList(text: string): Map<number, ProcInfo> {
    const procs = new Map<number, ProcInfo>();
    for (const line of text.split(/\r?\n/)) {
        const [pidText, ppidText, ...rest] = line.split("|");
        const pid = Number(pidText);
        if (!pidText || !Number.isInteger(pid)) continue;
        procs.set(pid, { pid, ppid: Number(ppidText), exe: rest.join("|").trim() });
    }
    return procs;
}

export function chainFrom(procs: Map<number, ProcInfo>, start: number, max = 8): ProcInfo[] {
    const chain: ProcInfo[] = [];
    const seen = new Set<number>();
    let pid = start;
    while (chain.length < max && !seen.has(pid)) {
        const p = procs.get(pid);
        if (!p) break;
        chain.push(p);
        seen.add(pid);
        pid = p.ppid;
    }
    return chain;
}

// The full process list can be large on a busy machine.
const PROCESS_LIST_MAX_BUFFER = 16 * 1024 * 1024;

export async function parentChain(start: number, deps: { platform: NodeJS.Platform; run?: OutputRunner }): Promise<ProcInfo[]> {
    if (deps.platform !== "win32") return [];
    try {
        const out = await (deps.run ?? runForOutput({ maxBuffer: PROCESS_LIST_MAX_BUFFER }))("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PROCESS_QUERY]);
        return chainFrom(parseProcessList(out), start);
    }
    catch {
        return [];
    }
}
