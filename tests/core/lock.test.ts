import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LOCK_TIMEOUT_MS, LOCK_FILE, withPoolLock } from "../../src/core/lock.js";

describe("withPoolLock", () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), "wtp-lock-"));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("creates the pool root and removes the lock afterwards", async () => {
        const pool = path.join(dir, "x-wt-pool");
        expect(await withPoolLock(pool, async () => 42)).toBe(42);
        expect(existsSync(pool)).toBe(true);
        expect(existsSync(path.join(pool, LOCK_FILE))).toBe(false);
    });

    it("runs callers one at a time", async () => {
        let active = 0;
        let maxActive = 0;
        const job = () => withPoolLock(dir, async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await sleep(30);
            active--;
        });
        await Promise.all([job(), job(), job()]);
        expect(maxActive).toBe(1);
    });

    it("releases the lock when the callback throws", async () => {
        await expect(withPoolLock(dir, async () => {
            throw new Error("boom");
        })).rejects.toThrow("boom");
        expect(existsSync(path.join(dir, LOCK_FILE))).toBe(false);
    });

    it("replaces a lock whose process is gone", async () => {
        const child = spawn(process.execPath, ["-e", ""]);
        await once(child, "exit");
        await writeFile(path.join(dir, LOCK_FILE), JSON.stringify({ pid: child.pid, time: Date.now() }));
        expect(await withPoolLock(dir, async () => "ok")).toBe("ok");
    });

    it("keeps an old lock while its process still runs", async () => {
    // A slow assign (fetch + checkout) can hold the lock for minutes; age alone must not break it.
        await writeFile(path.join(dir, LOCK_FILE), JSON.stringify({ pid: process.pid, time: Date.now() - 5 * 60_000 }));
        await expect(withPoolLock(dir, async () => 1, { timeoutMs: 200 })).rejects.toMatchObject({ name: "UserError" });
    });

    it("replaces an empty lock left by a crash", async () => {
        const file = path.join(dir, LOCK_FILE);
        await writeFile(file, "");
        const past = new Date(Date.now() - 60_000);
        await utimes(file, past, past);
        expect(await withPoolLock(dir, async () => "ok", { timeoutMs: 500 })).toBe("ok");
    });

    it("waits long enough for a slow checkout by default", () => {
        expect(DEFAULT_LOCK_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
    });

    it("times out with a UserError when a live process holds the lock", async () => {
        await writeFile(path.join(dir, LOCK_FILE), JSON.stringify({ pid: process.pid, time: Date.now() }));
        await expect(withPoolLock(dir, async () => 1, { timeoutMs: 200 })).rejects.toMatchObject({ name: "UserError" });
    });
});
