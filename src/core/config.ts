import { tryGit } from "./git.js";

export interface WtpConfig {
  base: string;
  remote: string;
}

async function get(root: string, key: string, fallback: string): Promise<string> {
    const r = await tryGit(["config", "--get", key], root);
    const value = r.ok ? r.stdout.trim() : "";
    return value || fallback;
}

export async function readConfig(root: string): Promise<WtpConfig> {
    const [base, remote] = await Promise.all([
        get(root, "wtp.base", "main"),
        get(root, "wtp.remote", "origin")
    ]);
    return { base, remote };
}
