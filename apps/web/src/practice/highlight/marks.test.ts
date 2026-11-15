import { describe, expect, it } from "vitest";
import { erase, eraseAt, eraseRange, hasMarks, liveClass, markAt, paint, segmentText, setPiece, snapRange, stroke, strokeRange, textRuns, type Mark, type Run } from "./marks";

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

describe("erasing with the eraser", () => {
  const yellow = (start: number, end: number): Mark => ({ start, end, color: "yellow" });
  const blue = (start: number, end: number): Mark => ({ start, end, color: "blue" });
  const segments = segmentText(STEM);
  const at = (word: string) => segmentOf(STEM, STEM.indexOf(word));
  const mark = (from: string, to: string, color: Mark["color"] = "yellow"): Mark => ({ start: STEM.indexOf(from), end: STEM.indexOf(to) + to.length, color });
  const texts = (marks: readonly Mark[]) => marks.map((one) => words(STEM, one.start, one.end));

  it("takes a range out of the marks: a mark inside it goes, and the rest of one it cuts stays", () => {
    expect(erase([yellow(0, 10), blue(12, 20), yellow(30, 40)], 5, 35)).toEqual([yellow(0, 5), yellow(35, 40)]);
    expect(erase([yellow(0, 30)], 10, 20)).toEqual([yellow(0, 10), yellow(20, 30)]);
  });

  it("leaves the marks as they are where there is none to erase", () => {
    const marks = [yellow(0, 10)];
    expect(erase(marks, 10, 20)).toBe(marks);
    expect(erase(marks, 4, 4)).toBe(marks);
  });

  it("clears the words a drag covers with the spaces and punctuation beside them", () => {
    const range = eraseRange(segments, at("dark"), at("amber"));
    expect(range && words(STEM, range.start, range.end)).toBe(" dark amber, ");
    expect(eraseRange(segments, at(" is"), at(" is"))).toBeNull();
  });

  it("works on the words alone with a color, and on the words and what is beside them with the eraser", () => {
    expect(strokeRange(segments, at("dark"), at("amber"), "blue")).toEqual(snapRange(segments, at("dark"), at("amber")));
    expect(strokeRange(segments, at("dark"), at("amber"), "eraser")).toEqual(eraseRange(segments, at("dark"), at("amber")));
  });

  it("erases the marks under a drag, in either direction, and what is left still ends on a word", () => {
    const marks = [mark("cloudy", "amber")];
    expect(texts(stroke(marks, segments, at("dark"), at("amber"), "eraser"))).toEqual(["cloudy and"]);
    expect(texts(stroke(marks, segments, at("amber"), at("dark"), "eraser"))).toEqual(["cloudy and"]);
    expect(texts(stroke(marks, segments, at("and"), at("and"), "eraser"))).toEqual(["cloudy", "dark amber"]);
  });

  it("erases every mark a drag crosses, whatever its color, and only those", () => {
    const marks = [mark("urine", "urine", "pink"), mark("cloudy", "dark"), mark("amber", "amber", "blue"), mark("hours", "hours")];
    expect(texts(stroke(marks, segments, at("is"), at("mL"), "eraser"))).toEqual(["urine", "hours"]);
  });

  it("changes nothing when the eraser's drag meets no mark or no word", () => {
    const marks = [mark("cloudy", "amber")];
    expect(stroke(marks, segments, at("last"), at("hours"), "eraser")).toBe(marks);
    expect(stroke(marks, segments, at(" is"), at(" is"), "eraser")).toBe(marks);
  });

  it("paints with a color, as a drag always has", () => {
    expect(stroke([], segments, at("cloudy"), at("amber"), "pink")).toEqual([mark("cloudy", "amber", "pink")]);
    expect(stroke([], segments, at(" is"), at(" is"), "pink")).toEqual([]);
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
  it("splits the text into runs at each mark's edges", () => {
    const text = "one two three four";
    const runs = textRuns(text, [
      { start: 4, end: 7, color: "blue" },
      { start: 8, end: 13, color: "pink" },
    ]);
    expect(runs.map((run) => [text.slice(run.start, run.end), run.color])).toEqual([
      ["one ", null],
      ["two", "blue"],
      [" ", null],
      ["three", "pink"],
      [" four", null],
    ]);
  });

  it("draws text with no mark as one run, and no text as none", () => {
    expect(textRuns("one two", [])).toEqual([{ start: 0, end: 7, color: null }]);
    expect(textRuns("", [])).toEqual([]);
  });
});

describe("drawing the drag in progress", () => {
  // "one two three four": one 0-3, two 4-7, three 8-13, four 14-18.
  const plain: Run = { start: 0, end: 18, color: null };
  const marked: Run = { start: 4, end: 13, color: "yellow" };

  it("colors the words a drag is painting, and says which are its first and last", () => {
    const live = { start: 4, end: 13, tool: "blue" } as const;
    expect(liveClass({ start: 4, end: 7 }, plain, live)).toBe("hl-live hl-blue hl-live-first");
    expect(liveClass({ start: 7, end: 8 }, plain, live)).toBe("hl-live hl-blue");
    expect(liveClass({ start: 8, end: 13 }, plain, live)).toBe("hl-live hl-blue hl-live-last");
    expect(liveClass({ start: 4, end: 7 }, plain, { start: 4, end: 7, tool: "pink" })).toBe("hl-live hl-pink hl-live-first hl-live-last");
  });

  it("paints over a mark of another color as it paints plain words", () => {
    expect(liveClass({ start: 8, end: 13 }, marked, { start: 8, end: 18, tool: "blue" })).toBe("hl-live hl-blue hl-live-first");
  });

  it("leaves the words outside the drag, and all of them when there is no drag, as they are", () => {
    expect(liveClass({ start: 0, end: 3 }, plain, { start: 4, end: 13, tool: "blue" })).toBe("");
    expect(liveClass({ start: 14, end: 18 }, plain, { start: 4, end: 13, tool: "blue" })).toBe("");
    expect(liveClass({ start: 4, end: 7 }, plain, null)).toBe("");
  });

  it("under the eraser, fades the marked words it would clear, out to the ends of their mark, and leaves plain words alone", () => {
    const live = { start: 3, end: 14, tool: "eraser" } as const;
    expect(liveClass({ start: 4, end: 7 }, marked, live)).toBe("hl-erasing hl-live-first");
    expect(liveClass({ start: 7, end: 8 }, marked, live)).toBe("hl-erasing");
    expect(liveClass({ start: 8, end: 13 }, marked, live)).toBe("hl-erasing hl-live-last");
    expect(liveClass({ start: 3, end: 4 }, plain, live)).toBe("");
    expect(liveClass({ start: 4, end: 7 }, marked, { start: 7, end: 14, tool: "eraser" })).toBe("");
  });
});
