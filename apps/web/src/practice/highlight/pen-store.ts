// What this device remembers about the highlighter: the pen's last color. Storage can be blocked
// or empty, so every read falls back to the default and every write may quietly do nothing.

import { HIGHLIGHT_COLORS, type HighlightColor } from "./marks";

const COLOR_KEY = "qbank.highlighter.color";

export function readPenColor(): HighlightColor {
  const stored = read(COLOR_KEY);
  return HIGHLIGHT_COLORS.find((color) => color === stored) ?? "yellow";
}

export function savePenColor(color: HighlightColor): void {
  write(COLOR_KEY, color);
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
