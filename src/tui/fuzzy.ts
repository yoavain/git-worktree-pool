import type { BranchChoice } from "../core/branch.js";

export interface Suggestion {
  name: string;
  source: "local" | "remote" | "new";
}

const BOUNDARY = "/-_.";

export function fuzzyScore(query: string, text: string): number | null {
    if (!query) return 0;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let from = 0;
    let streak = 0;
    let score = 0;
    for (const ch of q) {
        const found = t.indexOf(ch, from);
        if (found < 0) return null;
        streak = found === from ? streak + 1 : 0;
        const atBoundary = found === 0 || BOUNDARY.includes(t[found - 1]!);
        score += 1 + streak * 2 + (atBoundary ? 3 : 0);
        from = found + 1;
    }
    if (t.startsWith(q)) score += 10;
    if (t === q) score += 20;
    return score - t.length * 0.01;
}

export function suggestBranches(query: string, choices: BranchChoice[], limit = 8): Suggestion[] {
    const scored = choices
        .map((c) => ({ c, score: fuzzyScore(query, c.name) }))
        .filter((x): x is { c: BranchChoice; score: number } => x.score !== null)
        .sort((a, b) =>
            b.score - a.score
      || (a.c.source === b.c.source ? 0 : a.c.source === "local" ? -1 : 1)
      || a.c.name.localeCompare(b.c.name))
        .slice(0, limit)
        .map((x): Suggestion => ({ name: x.c.name, source: x.c.source }));
    const typed = query.trim();
    if (typed && !choices.some((c) => c.name === typed)) scored.push({ name: typed, source: "new" });
    return scored;
}
