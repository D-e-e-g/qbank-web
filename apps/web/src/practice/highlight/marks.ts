// Highlights the user paints on a question while reading it. A mark is a range of one piece of
// text (the stem, the ask, a table cell, one answer's text) in one of three colors. Offsets count
// UTF-16 units, as JavaScript strings and the iPhone app's NSRange both do. Marks live with the
// attempt on this device, the way strikes do: never sent, saved, or scored.

export const HIGHLIGHT_COLORS = ["yellow", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

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

/**
 * The range a drag covers, from the segment it began on to the one it is on now, in either
 * direction, without spaces or punctuation at either end. Null when it covers no word.
 */
export function snapRange(segments: readonly Segment[], from: number, to: number): { start: number; end: number } | null {
  let first = Math.min(from, to);
  let last = Math.max(from, to);
  while (first <= last && segments[first]?.word === false) first += 1;
  while (last >= first && segments[last]?.word === false) last -= 1;
  const start = segments[first];
  const end = segments[last];
  if (first > last || !start || !end) return null;
  return { start: start.start, end: end.end };
}

/**
 * Paints `start` to `end` in `color`: what it covers takes the new color, the rest of a mark it
 * cuts through stays, and marks of one color that touch or overlap become one.
 */
export function paint(marks: readonly Mark[], start: number, end: number, color: HighlightColor): readonly Mark[] {
  if (end <= start) return marks;
  const kept: Mark[] = [];
  for (const mark of marks) {
    if (mark.end <= start || mark.start >= end) {
      kept.push(mark);
      continue;
    }
    if (mark.start < start) kept.push({ ...mark, end: start });
    if (mark.end > end) kept.push({ ...mark, start: end });
  }
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

/** A stretch of text drawn one way: unmarked (color null), or in one color. `live` while a drag paints it. */
export interface Run {
  start: number;
  end: number;
  color: HighlightColor | null;
  live: boolean;
}

/** The text cut at every mark's edges, with the drag in progress painted over the marks. */
export function textRuns(text: string, marks: readonly Mark[], live: Mark | null = null): Run[] {
  const shown = live ? paint(marks, live.start, live.end, live.color) : marks;
  const runs: Run[] = [];
  let at = 0;
  for (const mark of shown) {
    const start = Math.max(mark.start, at);
    const end = Math.min(mark.end, text.length);
    if (end <= start) continue;
    if (start > at) runs.push({ start: at, end: start, color: null, live: false });
    const holdsLive = live !== null && mark.color === live.color && mark.start <= live.start && live.end <= mark.end;
    // A live drag that merged into a mark of its color draws only its own part live.
    if (live && holdsLive && (mark.start < live.start || mark.end > live.end)) {
      if (live.start > start) runs.push({ start, end: live.start, color: mark.color, live: false });
      runs.push({ start: live.start, end: live.end, color: mark.color, live: true });
      if (end > live.end) runs.push({ start: live.end, end, color: mark.color, live: false });
    } else {
      runs.push({ start, end, color: mark.color, live: holdsLive });
    }
    at = end;
  }
  if (at < text.length) runs.push({ start: at, end: text.length, color: null, live: false });
  return runs;
}
