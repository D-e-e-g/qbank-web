import { describe, expect, it } from "vitest";
import { examStrip, type ItemState } from "../exam/runner";
import type { LoadedQuestion, LoadedSet } from "./model";
import type { Feedback } from "./recordPracticeAnswer";
import { beginSession, practiceStep, progressStrip, type PracticeEvent, type Session } from "./session";

function loaded(id: string, position: number): LoadedQuestion {
  return {
    id,
    publicId: id,
    position,
    topic: "",
    cj: null,
    stem: "Stem",
    ask: "Ask",
    rationale: "Rationale",
    takeaway: "Takeaway",
    terms: [],
    table: null,
    images: [],
    question: { type: "single", options: [{ t: "Right", ok: true }, { t: "Wrong" }] },
  };
}

const set: LoadedSet = {
  id: "set",
  courseId: "course",
  title: "Week 1",
  weekLabel: "Week 1",
  questions: [loaded("q1", 0), loaded("q2", 1), loaded("q3", 2), loaded("q4", 3)],
  sitting: null,
  run: null,
};

const scored = (status: Feedback["status"]): Feedback => ({ status, points: 0, maxPoints: 1, label: status, pointsText: null, ruleText: null });

/** Answers the question on screen and takes the server's score for it. */
function check(session: Session, score: Feedback): Session {
  const clientAttemptId = session.attempts[session.index]?.clientAttemptId ?? "";
  const events: PracticeEvent[] = [
    { type: "edit", change: () => ({ draft: { type: "single", choice: 0 } }) },
    { type: "check" },
    { type: "checked", clientAttemptId, score },
  ];
  return events.reduce(practiceStep, session);
}

const next = (session: Session): Session => practiceStep(session, { type: "next" });

describe("the practice progress strip", () => {
  it("leaves each checked question's result on the strip, and marks the one on screen", () => {
    let session = beginSession(set, "set");
    expect(progressStrip(session)).toEqual(["now", "todo", "todo", "todo"]);
    session = next(check(session, scored("correct")));
    session = next(check(session, scored("partial")));
    session = check(session, scored("incorrect"));
    expect(progressStrip(session)).toEqual(["right", "partial", "missed", "todo"]);
    session = next(session);
    expect(progressStrip(session)).toEqual(["right", "partial", "missed", "now"]);
  });
});

describe("the exam progress strip", () => {
  const item = (over: Partial<ItemState>): ItemState => ({
    layout: { kind: "options", order: [0, 1] },
    draft: { type: "single", choice: null },
    struck: [],
    marks: {},
    guessed: false,
    clientAttemptId: "attempt",
    submitted: false,
    skipped: false,
    ...over,
  });

  it("shows answered and skipped only, never right or wrong", () => {
    const items = [item({ submitted: true }), item({ skipped: true }), item({}), item({})];
    expect(examStrip(items, 2)).toEqual(["answered", "skipped", "now", "todo"]);
    expect(examStrip(items, null)).toEqual(["answered", "skipped", "todo", "todo"]);
  });
});
