// What this device remembers about the highlighter: the pen's last color, and whether the eraser
// is out in its place. Storage can be blocked or empty, so every read falls back to the default
// and every write may quietly do nothing.

import { HIGHLIGHT_COLORS, type HighlightColor, type Tool } from "./marks";

const COLOR_KEY = "qbank.highlighter.color";
const ERASER_KEY = "qbank.highlighter.eraser";

export function readPenColor(): HighlightColor {
  const stored = read(COLOR_KEY);
  return HIGHLIGHT_COLORS.find((color) => color === stored) ?? "yellow";
}

/** What the pen was last set to do: paint in a color, or erase. */
export function readPenTool(): Tool {
  return read(ERASER_KEY) === "1" ? "eraser" : readPenColor();
}

/** Keeps the tool for the next question and the next visit. The eraser leaves the last color as it was. */
export function savePenTool(tool: Tool): void {
  write(ERASER_KEY, tool === "eraser" ? "1" : "0");
  if (tool !== "eraser") write(COLOR_KEY, tool);
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Kept for this visit only.
  }
}
