// Plain output stays ASCII: Windows PowerShell 5.1 writes stdout in the OEM code page. The Ink TUI keeps the glyphs.
export interface Glyphs {
  arrow: string;
  ahead: string;
  behind: string;
  none: string;
  here: string;
  ellipsis: string;
}

export const PLAIN_GLYPHS: Glyphs = { arrow: "->", ahead: "ahead ", behind: "behind ", none: "-", here: "*", ellipsis: "..." };
export const TUI_GLYPHS: Glyphs = { arrow: "→", ahead: "↑", behind: "↓", none: "—", here: "●", ellipsis: "…" };
