// Highlights the user paints on a question while reading it. A mark is a range of one piece of
// text (the stem, the ask, a table cell, one answer's text) in one of three colors. Offsets count
// UTF-16 units, as JavaScript strings and the iPhone app's NSRange both do. Marks live with the
// attempt on this device, the way strikes do: never sent, saved, or scored.

export const HIGHLIGHT_COLORS = ["yellow", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** What the pen does to the words a drag covers: paints them in a color, or erases their marks. */
export type Tool = HighlightColor | "eraser";

export interface Range {
  start: number;
  end: number;
}

export interface Mark {
  start: number;
  end: number;
  color: HighlightColor;
}

/** Every mark on one question, by piece of text. A piece with no marks has no entry. */
export type Marks = Readonly<Record<string, readonly Mark[]>>;

/** A stretch of text: a word, a run of spaces, or a punctuation mark. Only words start or end a mark. */
export interface Segment {
  start: number;
  end: number;
  word: boolean;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

export function segmentText(text: string): Segment[] {
  return Array.from(segmenter.segment(text), (part) => ({
    start: part.index,
    end: part.index + part.segment.length,
    word: part.isWordLike === true,
  }));
}

/** The first and last word between two segments, in either order. Null when there is no word. */
function wordSpan(segments: readonly Segment[], from: number, to: number): [number, number] | null {
  let first = Math.min(from, to);
  let last = Math.max(from, to);
  while (first <= last && segments[first]?.word !== true) first += 1;
  while (last >= first && segments[last]?.word !== true) last -= 1;
  return first > last ? null : [first, last];
}

function rangeOf(segments: readonly Segment[], first: number, last: number): Range | null {
  const start = segments[first];
  const end = segments[last];
  return start && end ? { start: start.start, end: end.end } : null;
}

/**
 * The range a drag covers, from the segment it began on to the one it is on now, in either
 * direction, without spaces or punctuation at either end. Null when it covers no word.
 */
export function snapRange(segments: readonly Segment[], from: number, to: number): Range | null {
  const words = wordSpan(segments, from, to);
  return words ? rangeOf(segments, words[0], words[1]) : null;
}

/**
 * The range a drag with the eraser clears: the words it covers, with the spaces and punctuation
 * on either side of them, so what is left of a mark it cuts through still starts and ends on a
 * word. Null when it covers no word.
 */
export function eraseRange(segments: readonly Segment[], from: number, to: number): Range | null {
  const words = wordSpan(segments, from, to);
  if (!words) return null;
  let [first, last] = words;
  while (segments[first - 1]?.word === false) first -= 1;
  while (segments[last + 1]?.word === false) last += 1;
  return rangeOf(segments, first, last);
}

/** The range a drag from one segment to another works on with `tool`. Null when it covers no word. */
export function strokeRange(segments: readonly Segment[], from: number, to: number, tool: Tool): Range | null {
  return tool === "eraser" ? eraseRange(segments, from, to) : snapRange(segments, from, to);
}

/** The marks with `start` to `end` taken out: a mark inside it goes, and the rest of a mark it cuts through stays. */
function cut(marks: readonly Mark[], start: number, end: number): Mark[] {
  const kept: Mark[] = [];
  for (const mark of marks) {
    if (mark.end <= start || mark.start >= end) {
      kept.push(mark);
      continue;
    }
    if (mark.start < start) kept.push({ ...mark, end: start });
    if (mark.end > end) kept.push({ ...mark, start: end });
  }
  return kept;
}

/**
 * Paints `start` to `end` in `color`: what it covers takes the new color, the rest of a mark it
 * cuts through stays, and marks of one color that touch or overlap become one.
 */
export function paint(marks: readonly Mark[], start: number, end: number, color: HighlightColor): readonly Mark[] {
  if (end <= start) return marks;
  const kept = cut(marks, start, end);
  kept.push({ start, end, color });
  kept.sort((a, b) => a.start - b.start);
  const merged: Mark[] = [];
  for (const mark of kept) {
    const last = merged.at(-1);
    if (last?.color === mark.color && last.end >= mark.start) merged[merged.length - 1] = { ...last, end: Math.max(last.end, mark.end) };
    else merged.push(mark);
  }
  return merged;
}

/**
 * Erases `start` to `end`: a mark inside it goes, and the rest of a mark it cuts through stays.
 * The same list when no mark is there.
 */
export function erase(marks: readonly Mark[], start: number, end: number): readonly Mark[] {
  if (end <= start || !marks.some((mark) => mark.end > start && mark.start < end)) return marks;
  return cut(marks, start, end);
}

/** The marks after a drag from one segment to another with `tool`. The same list when nothing changes. */
export function stroke(marks: readonly Mark[], segments: readonly Segment[], from: number, to: number, tool: Tool): readonly Mark[] {
  const range = strokeRange(segments, from, to, tool);
  if (!range) return marks;
  return tool === "eraser" ? erase(marks, range.start, range.end) : paint(marks, range.start, range.end, tool);
}

export function markAt(marks: readonly Mark[], offset: number): Mark | undefined {
  return marks.find((mark) => mark.start <= offset && offset < mark.end);
}

/** Erases the whole mark under a tap. The same list when there is none there. */
export function eraseAt(marks: readonly Mark[], offset: number): readonly Mark[] {
  const hit = markAt(marks, offset);
  return hit ? marks.filter((mark) => mark !== hit) : marks;
}

export function setPiece(all: Marks, piece: string, marks: readonly Mark[]): Marks {
  const rest = Object.entries(all).filter(([key]) => key !== piece);
  return Object.fromEntries(marks.length === 0 ? rest : [...rest, [piece, marks]]);
}

export function hasMarks(all: Marks): boolean {
  return Object.values(all).some((marks) => marks.length > 0);
}

/** A stretch of text drawn one way: unmarked (color null), or in one color. */
export interface Run {
  start: number;
  end: number;
  color: HighlightColor | null;
}

/** The text cut at every mark's edges. */
export function textRuns(text: string, marks: readonly Mark[]): Run[] {
  const runs: Run[] = [];
  let at = 0;
  for (const mark of marks) {
    const start = Math.max(mark.start, at);
    const end = Math.min(mark.end, text.length);
    if (end <= start) continue;
    if (start > at) runs.push({ start: at, end: start, color: null });
    runs.push({ start, end, color: mark.color });
    at = end;
  }
  if (at < text.length) runs.push({ start: at, end: text.length, color: null });
  return runs;
}

/** The drag in progress on one piece of text: the range it would work on, and with what. */
export interface LiveStroke extends Range {
  tool: Tool;
}

/**
 * How a segment of `run` shows the drag in progress, as class names: painted in the pen's color,
 * or, under the eraser, a marked word about to lose its mark. Empty when the drag leaves it as it
 * is. The first and last segment say so, to round the ends as a mark's are.
 */
export function liveClass(segment: Range, run: Run, live: LiveStroke | null): string {
  if (!live || segment.start < live.start || segment.end > live.end) return "";
  const erasing = live.tool === "eraser";
  if (erasing && run.color === null) return "";
  const edges = erasing ? run : live;
  return [erasing ? "hl-erasing" : `hl-live hl-${live.tool}`, segment.start === edges.start ? "hl-live-first" : "", segment.end === edges.end ? "hl-live-last" : ""].filter(Boolean).join(" ");
}
