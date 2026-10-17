import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { doctorCommand, type DoctorDeps } from "../../src/cli/commands/doctor.js";
import type { Args } from "../../src/cli/main.js";
import type { FsDeps } from "../../src/platform/launchers.js";
import { MARKER, profileLine } from "../../src/platform/shell-init.js";
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
        await doctorCommand(args, t.io, deps({ "C:\\bin\\wtp.cmd": "rem wtp-launcher 2" }, "Restricted"));
        expect(t.err()).toContain("Set-ExecutionPolicy");
    });

    it("names the launcher that wins, and warns about nothing when everything is fine", async () => {
        const t = io();
        await doctorCommand(args, t.io, deps({ "C:\\bin\\wtp.cmd": "rem wtp-launcher 2" }));
        expect(t.out()).toContain("wtp -> C:\\bin\\wtp.cmd");
        expect(t.err()).toBe("");
    });
});

describe("doctor wtp check (POSIX)", () => {
    let fx: Fixture;
    let home: string;
    beforeEach(async () => {
        fx = await makeRepo();
        home = mkdtempSync(path.join(os.tmpdir(), "wtp-home-"));
    });
    afterEach(async () => {
        await fx.cleanup();
    });

    const io = () => makeIo(fx.root, { platform: "linux", home, env: { PATH: "/usr/bin", SHELL: "/bin/bash" } });

    it("names the profile function", async () => {
        writeFileSync(path.join(home, ".bashrc"), `${MARKER}\n${profileLine("bash")}\n`);
        const t = io();
        expect(await doctorCommand(args, t.io, deps({ "/usr/bin/wtp": "# wtp-launcher 2" }))).toBe(0);
        expect(t.out()).toContain(`wtp -> the wtp function in ${path.join(home, ".bashrc")}`);
        expect(t.err()).toBe("");
    });

    it("names the sh launcher, and says it can't change the folder", async () => {
        const t = io();
        expect(await doctorCommand(args, t.io, deps({ "/usr/bin/wtp": "# wtp-launcher 2" }))).toBe(0);
        expect(t.out()).toContain("wtp -> /usr/bin/wtp");
        expect(t.err()).toContain("worktree-pool setup");
    });

    it("warns when wtp is not set up", async () => {
        const t = io();
        expect(await doctorCommand(args, t.io, deps({}))).toBe(0);
        expect(t.err()).toContain("wtp is not set up");
    });
});
