import { describe, expect, it } from "vitest";
import { eraseAt, hasMarks, markAt, paint, segmentText, setPiece, snapRange, textRuns, type Mark } from "./marks";

const STEM = "The urine is cloudy and dark amber, 90 mL in the last 6 hours.";

function words(text: string, start: number, end: number): string {
  return text.slice(start, end);
}

/** The offsets of the segment holding this character. */
function segmentOf(text: string, offset: number): number {
  const index = segmentText(text).findIndex((segment) => segment.start <= offset && offset < segment.end);
  if (index === -1) throw new Error(`no segment at ${String(offset)}`);
  return index;
}

describe("segmenting question text", () => {
  it("splits words, spaces and punctuation, covering the whole text", () => {
    const segments = segmentText("Skin cool, 4 sec.");
    expect(segments.map((segment) => "Skin cool, 4 sec.".slice(segment.start, segment.end))).toEqual(["Skin", " ", "cool", ",", " ", "4", " ", "sec", "."]);
    expect(segments.filter((segment) => segment.word).map((segment) => segment.start)).toEqual([0, 5, 11, 13]);
    expect(segments.at(-1)?.end).toBe(17);
  });

  it("returns nothing for empty text", () => {
    expect(segmentText("")).toEqual([]);
  });
});

describe("snapping a drag to whole words", () => {
  const segments = segmentText(STEM);

  it("covers every word from where the drag began to where it is, in either direction", () => {
    const from = segmentOf(STEM, STEM.indexOf("cloudy"));
    const to = segmentOf(STEM, STEM.indexOf("amber") + 2);
    const forward = snapRange(segments, from, to);
    const backward = snapRange(segments, to, from);
    expect(forward).not.toBeNull();
    expect(backward).toEqual(forward);
    if (!forward) return;
    expect(words(STEM, forward.start, forward.end)).toBe("cloudy and dark amber");
  });

  it("marks one word when the drag stays on it", () => {
    const at = segmentOf(STEM, STEM.indexOf("urine"));
    const range = snapRange(segments, at, at);
    expect(range && words(STEM, range.start, range.end)).toBe("urine");
  });

  it("drops the spaces at either end and refuses a drag over spaces alone", () => {
    const space = segmentOf(STEM, STEM.indexOf(" is"));
    expect(snapRange(segments, space, space)).toBeNull();
    const range = snapRange(segments, space, segmentOf(STEM, STEM.indexOf("cloudy")));
    expect(range && words(STEM, range.start, range.end)).toBe("is cloudy");
  });
});

describe("painting and erasing marks", () => {
  const yellow = (start: number, end: number): Mark => ({ start, end, color: "yellow" });
  const blue = (start: number, end: number): Mark => ({ start, end, color: "blue" });

  it("adds a mark and keeps marks in reading order", () => {
    expect(paint([yellow(20, 30)], 0, 5, "pink")).toEqual([{ start: 0, end: 5, color: "pink" }, yellow(20, 30)]);
  });

  it("merges a mark that touches or overlaps one of the same color", () => {
    expect(paint([yellow(0, 10)], 10, 15, "yellow")).toEqual([yellow(0, 15)]);
    expect(paint([yellow(0, 10), yellow(20, 30)], 5, 25, "yellow")).toEqual([yellow(0, 30)]);
  });

  it("repaints the part a drag in another color covers, and keeps the rest", () => {
    expect(paint([yellow(0, 30)], 10, 20, "blue")).toEqual([yellow(0, 10), blue(10, 20), yellow(20, 30)]);
    expect(paint([yellow(0, 10), blue(12, 20)], 0, 20, "pink")).toEqual([{ start: 0, end: 20, color: "pink" }]);
  });

  it("does nothing for an empty range", () => {
    const marks = [yellow(0, 10)];
    expect(paint(marks, 4, 4, "blue")).toBe(marks);
  });

  it("finds and erases the whole mark under a tap, and leaves the others", () => {
    const marks = [yellow(0, 10), blue(20, 30)];
    expect(markAt(marks, 25)).toEqual(blue(20, 30));
    expect(markAt(marks, 15)).toBeUndefined();
    expect(markAt(marks, 10)).toBeUndefined();
    expect(eraseAt(marks, 3)).toEqual([blue(20, 30)]);
    expect(eraseAt(marks, 15)).toBe(marks);
  });
});

describe("marks of a whole question", () => {
  it("stores each piece of text on its own and drops a piece left with none", () => {
    const one = setPiece({}, "stem", [{ start: 0, end: 3, color: "yellow" }]);
    expect(one).toEqual({ stem: [{ start: 0, end: 3, color: "yellow" }] });
    expect(hasMarks(one)).toBe(true);
    const both = setPiece(one, "option:2", [{ start: 1, end: 4, color: "pink" }]);
    expect(Object.keys(both)).toEqual(["stem", "option:2"]);
    const cleared = setPiece(setPiece(both, "stem", []), "option:2", []);
    expect(cleared).toEqual({});
    expect(hasMarks(cleared)).toBe(false);
  });
});

describe("drawing marked text", () => {
  it("splits the text into runs at each mark's edges, with the drag in progress drawn live", () => {
    const text = "one two three four";
    const runs = textRuns(text, [{ start: 4, end: 7, color: "blue" }], { start: 8, end: 13, color: "pink" });
    expect(runs.map((run) => [text.slice(run.start, run.end), run.color, run.live])).toEqual([
      ["one ", null, false],
      ["two", "blue", false],
      [" ", null, false],
      ["three", "pink", true],
      [" four", null, false],
    ]);
  });

  it("draws a live repaint over an existing mark", () => {
    const text = "one two three";
    const runs = textRuns(text, [{ start: 0, end: 13, color: "yellow" }], { start: 4, end: 7, color: "blue" });
    expect(runs.map((run) => [text.slice(run.start, run.end), run.color, run.live])).toEqual([
      ["one ", "yellow", false],
      ["two", "blue", true],
      [" three", "yellow", false],
    ]);
  });
});
