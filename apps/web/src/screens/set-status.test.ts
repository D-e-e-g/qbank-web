import { describe, expect, it } from "vitest";
import type { SetSummary } from "../api";
import { isFinishedSet, practiceSetIsFinished, statusLine } from "./set-status";

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
