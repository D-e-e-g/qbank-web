import { describe, expect, it } from "vitest";
import type { SetSummary } from "../api";
import { isFinishedSet, offersContinue, practiceSetIsFinished, setRun, statusLine } from "./set-status";

/** Noon today, so the row's date reads "today" in any timezone. */
function todayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString();
}

function set(questionCount: number, over: Partial<SetSummary> = {}): SetSummary {
  const today = todayIso();
  return {
    id: "set",
    title: "Invented set",
    description: "",
    questionCount,
    importedAt: today,
    activeSince: today,
    status: "imported",
    canRestore: false,
    answeredCount: 0,
    fullyRightCount: 0,
    lastAnsweredAt: null,
    questionIds: [],
    importedByAgent: null,
    sitting: null,
    ...over,
  };
}

describe("a set's run, as the server sends it", () => {
  it("words the row from the run alone", () => {
    expect(statusLine(set(12, { run: "new" }))).toBe("Imported today · 12 questions");
    expect(statusLine(set(12, { run: "new", status: "replaced" }))).toBe("Replaced today · 12 questions");
    expect(statusLine(set(12, { run: "midway", answeredCount: 9, sitting: { answeredCount: 4 } }))).toBe("4 of 12 answered");
    expect(statusLine(set(12, { run: "restarted", answeredCount: 9 }))).toBe("9 of 12 answered");
    expect(statusLine(set(12, { run: "done", answeredCount: 12, fullyRightCount: 9 }))).toBe("Done today · 9 of 12 fully right");
  });

  it("says Done on a done set with a retake under way, with no Continue", () => {
    const retake = set(12, { run: "done", answeredCount: 12, fullyRightCount: 9, sitting: { answeredCount: 3 } });
    expect(statusLine(retake)).toBe("Done today · 9 of 12 fully right");
    expect(offersContinue(retake)).toBe(false);
    expect(isFinishedSet(retake)).toBe(true);
  });

  it("does not count its way to a different state than the run", () => {
    // Counts that would read Done, on a set the server says she began again.
    const again = set(12, { run: "restarted", answeredCount: 12 });
    expect(isFinishedSet(again)).toBe(false);
    expect(statusLine(again)).toBe("12 of 12 answered");
    // A midway set whose sitting summary is missing still continues.
    expect(offersContinue(set(12, { run: "midway", answeredCount: 5 }))).toBe(true);
    expect(statusLine(set(12, { run: "midway", answeredCount: 5 }))).toBe("5 of 12 answered");
  });

  it("offers Continue only on a midway set, and calls only a done set finished", () => {
    for (const run of ["new", "midway", "restarted", "done"] as const) {
      const row = set(12, { run, answeredCount: 6, sitting: { answeredCount: 6 } });
      expect(setRun(row)).toBe(run);
      expect(offersContinue(row)).toBe(run === "midway");
      expect(isFinishedSet(row)).toBe(run === "done");
    }
  });

  it("finds a done set on the course by its run", () => {
    const course = { folders: [{ sets: [set(2, { id: "done", run: "done", answeredCount: 2 }), set(2, { id: "again", run: "restarted", answeredCount: 2 })] }] };
    expect(practiceSetIsFinished(course, "done")).toBe(true);
    expect(practiceSetIsFinished(course, "again")).toBe(false);
  });
});

describe("a set's run from a server that does not send it", () => {
  it("is read from the sitting and counts as before", () => {
    expect(setRun(set(12))).toBe("new");
    expect(setRun(set(0))).toBe("new");
    expect(setRun(set(12, { answeredCount: 4, sitting: { answeredCount: 4 } }))).toBe("midway");
    expect(setRun(set(12, { answeredCount: 12, sitting: { answeredCount: 12 } }))).toBe("midway");
    expect(setRun(set(12, { answeredCount: 4 }))).toBe("restarted");
    expect(setRun(set(12, { answeredCount: 12 }))).toBe("done");
    expect(setRun(set(12, { answeredCount: 13 }))).toBe("done");
  });

  it("offers Continue only beside a sitting", () => {
    expect(offersContinue(set(12, { answeredCount: 4, sitting: { answeredCount: 4 } }))).toBe(true);
    expect(offersContinue(set(12, { answeredCount: 4 }))).toBe(false);
    expect(offersContinue(set(12, { answeredCount: 12 }))).toBe(false);
  });
});

describe("statusLine", () => {
  it("says one question, and questions when there are more", () => {
    expect(statusLine(set(1))).toBe("Imported today · 1 question");
    expect(statusLine(set(12))).toBe("Imported today · 12 questions");
    expect(statusLine(set(1, { status: "replaced" }))).toBe("Replaced today · 1 question");
    expect(statusLine(set(3, { status: "restored" }))).toBe("Restored today · 3 questions");
  });

  it("keeps the other counts for one question and for many", () => {
    expect(statusLine(set(1, { sitting: { answeredCount: 0 } }))).toBe("0 of 1 answered");
    expect(statusLine(set(12, { sitting: { answeredCount: 7 } }))).toBe("7 of 12 answered");
    expect(statusLine(set(1, { answeredCount: 1, fullyRightCount: 1 }))).toBe("Done today · 1 of 1 fully right");
    expect(statusLine(set(12, { answeredCount: 12, fullyRightCount: 9 }))).toBe("Done today · 9 of 12 fully right");
    expect(statusLine(set(12, { answeredCount: 4 }))).toBe("4 of 12 answered");
    expect(statusLine(set(12, { answeredCount: 12, fullyRightCount: 12, sitting: { answeredCount: 12 } }))).toBe("12 of 12 answered");
  });
});

describe("isFinishedSet", () => {
  it("is a set whose row says Done", () => {
    expect(isFinishedSet(set(1, { answeredCount: 1 }))).toBe(true);
    expect(isFinishedSet(set(12, { answeredCount: 12 }))).toBe(true);
    expect(isFinishedSet(set(12, { answeredCount: 13 }))).toBe(true);
    expect(isFinishedSet(set(1))).toBe(false);
    expect(isFinishedSet(set(12, { answeredCount: 4 }))).toBe(false);
    expect(isFinishedSet(set(0))).toBe(false);
    expect(isFinishedSet(set(12, { answeredCount: 12, sitting: { answeredCount: 12 } }))).toBe(false);
  });

  it("finds that set on the course, and treats a missing one as not finished", () => {
    const done = set(2, { id: "done", answeredCount: 2 });
    const open = set(2, { id: "open", answeredCount: 1 });
    const course = { folders: [{ sets: [done] }, { sets: [open] }] };
    expect(practiceSetIsFinished(course, "done")).toBe(true);
    expect(practiceSetIsFinished(course, "open")).toBe(false);
    expect(practiceSetIsFinished(course, "missing")).toBe(false);
    expect(practiceSetIsFinished(null, "done")).toBe(false);
  });
});
