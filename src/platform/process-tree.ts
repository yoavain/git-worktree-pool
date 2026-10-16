import { execFile } from "node:child_process";

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

export type Runner = (cmd: string, args: string[]) => Promise<string>;

const runCommand: Runner = (cmd, args) =>
    new Promise((resolve, reject) => {
        execFile(cmd, args, { windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout);
        });
    });

export async function parentChain(start: number, deps: { platform: NodeJS.Platform; run?: Runner }): Promise<ProcInfo[]> {
    if (deps.platform !== "win32") return [];
    try {
        const out = await (deps.run ?? runCommand)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PROCESS_QUERY]);
        return chainFrom(parseProcessList(out), start);
    }
    catch {
        return [];
    }
}
