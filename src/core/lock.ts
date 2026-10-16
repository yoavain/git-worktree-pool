import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { UserError } from "./errors.js";

export const LOCK_FILE = ".wtp.lock";
/** Long enough for a fetch (60 s limit) plus a full checkout under a lock held by another terminal. */
export const DEFAULT_LOCK_TIMEOUT_MS = 120_000;
/** A lock this old counts as stale even if its PID is alive, in case the OS reused the PID. */
const MAX_LOCK_AGE_MS = 60 * 60_000;
/** An empty or unreadable lock this old is a crash leftover, not a writer in progress. */
const UNREADABLE_GRACE_MS = 5_000;

async function isStale(file: string): Promise<boolean> {
    let data: { pid?: unknown; time?: unknown } | null;
    try {
        data = JSON.parse(await readFile(file, "utf8")) as { pid?: unknown; time?: unknown };
    }
    catch {
        data = null;
    }
    if (!data || typeof data.pid !== "number" || typeof data.time !== "number") {
        try {
            return Date.now() - (await stat(file)).mtimeMs > UNREADABLE_GRACE_MS;
        }
        catch {
            return false;
        }
    }
    if (Date.now() - data.time > MAX_LOCK_AGE_MS) return true;
    try {
        process.kill(data.pid, 0);
        return false;
    }
    catch (e) {
        return (e as NodeJS.ErrnoException).code === "ESRCH";
    }
}

export async function withPoolLock<T>(
    poolRoot: string,
    fn: () => Promise<T>,
    opts: { timeoutMs?: number } = {}
): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    await mkdir(poolRoot, { recursive: true });
    const file = path.join(poolRoot, LOCK_FILE);
    const start = Date.now();

    for (;;) {
        try {
            const handle = await open(file, "wx");
            await handle.writeFile(JSON.stringify({ pid: process.pid, time: Date.now() }));
            await handle.close();
            break;
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
            if (await isStale(file)) {
                await rm(file, { force: true });
                continue;
            }
            if (Date.now() - start > timeoutMs) {
                throw new UserError(`Another wtp command holds the pool lock (${file}). If no wtp command runs, delete that file.`);
            }
            await sleep(50);
        }
    }

    try {
        return await fn();
    }
    finally {
        await rm(file, { force: true });
    }
}
