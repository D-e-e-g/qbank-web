// What this device remembers about the highlighter: the pen's last color, and whether the user
// has highlighted before (which hides the one-line hint). Storage can be blocked or empty, so
// every read falls back to the default and every write may quietly do nothing.

import { HIGHLIGHT_COLORS, type HighlightColor } from "./marks";

const COLOR_KEY = "qbank.highlighter.color";
const USED_KEY = "qbank.highlighter.used";

export function readPenColor(): HighlightColor {
  const stored = read(COLOR_KEY);
  return HIGHLIGHT_COLORS.find((color) => color === stored) ?? "yellow";
}

export function savePenColor(color: HighlightColor): void {
  write(COLOR_KEY, color);
}

export function readHighlighterUsed(): boolean {
  return read(USED_KEY) === "1";
}

export function saveHighlighterUsed(): void {
  write(USED_KEY, "1");
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
