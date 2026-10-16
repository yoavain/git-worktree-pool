import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { doctorCommand, type DoctorDeps } from "../../src/cli/commands/doctor.js";
import type { Args } from "../../src/cli/main.js";
import type { FsDeps } from "../../src/platform/launchers.js";
import { makeIo } from "../helpers/io.js";
import { makeRepo, type Fixture } from "../helpers/repo.js";

const args: Args = { command: "doctor", positionals: [], values: {} };
const fs = (files: Record<string, string>): FsDeps => ({
    isFile: (p) => p in files,
    readHead: (p) => files[p] ?? null,
    isWritableDir: () => true
});
const deps = (files: Record<string, string>, policy: string | null = "RemoteSigned"): DoctorDeps => ({
    fs: fs(files),
    ps51Policy: async () => policy
});

describe("doctor launcher checks (Windows)", () => {
    let fx: Fixture;
    beforeEach(async () => {
        fx = await makeRepo();
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    const io = () => makeIo(fx.root, { platform: "win32", env: { PATH: "C:\\bin" } });

    it("warns when wtp is not set up, and keeps exit code 0", async () => {
        const t = io();
        expect(await doctorCommand(args, t.io, deps({}))).toBe(0);
        expect(t.err()).toContain("worktree-pool setup");
    });

    it("warns about a wtp that is not a launcher", async () => {
        const t = io();
        await doctorCommand(args, t.io, deps({ "C:\\bin\\wtp.exe": "MZ" }));
        expect(t.err()).toContain("C:\\bin\\wtp.exe runs as wtp, but it is not a wtp launcher");
    });

    it("warns about an old launcher", async () => {
        const t = io();
        await doctorCommand(args, t.io, deps({ "C:\\bin\\wtp.cmd": "rem wtp-launcher 0" }));
        expect(t.err()).toContain("is old");
    });

    it("notes a Restricted PowerShell 5.1 when the launcher is fine", async () => {
        const t = io();
        await doctorCommand(args, t.io, deps({ "C:\\bin\\wtp.cmd": "rem wtp-launcher 1" }, "Restricted"));
        expect(t.err()).toContain("Set-ExecutionPolicy");
    });

    it("is quiet when everything is fine", async () => {
        const t = io();
        await doctorCommand(args, t.io, deps({ "C:\\bin\\wtp.cmd": "rem wtp-launcher 1" }));
        expect(t.err()).toBe("");
    });
});
