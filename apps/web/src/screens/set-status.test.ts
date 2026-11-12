import { describe, expect, it } from "vitest";
import type { SetSummary } from "../api";
import { isFinishedSet, offersContinue, setRun, statusLine } from "./set-status";

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
    run: "new",
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
});
