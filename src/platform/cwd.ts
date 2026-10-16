import { writeFile } from "node:fs/promises";

export async function handoffCwd(dir: string, env: NodeJS.ProcessEnv): Promise<boolean> {
    const file = env.WTP_CWD_FILE;
    if (!file) return false;
    await writeFile(file, dir, "utf8");
    return true;
}
