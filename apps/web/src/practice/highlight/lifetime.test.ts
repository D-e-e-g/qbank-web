// How long highlights last: for the attempt, on this device, the way strikes do. They stay
// after Check answer until the set is closed, stay on a skipped exam question, and are never
// part of an answer that goes to the server.

import { describe, expect, it } from "vitest";
import { initialPhase, runnerReduce, type ItemState, type RunnerEvent, type RunnerState } from "../../exam/runner";
import type { LoadedQuestion, LoadedSet, Question } from "../model";
import type { Feedback } from "../recordPracticeAnswer";
import { advance, beginSession, markAttempt, reveal, startOver, type Session } from "../session";
import type { Marks } from "./marks";

function loaded(id: string, position: number, question: Question): LoadedQuestion {
  return {
    id,
    publicId: id,
    position,
    topic: "",
    cj: null,
    stem: "The urine is cloudy and dark amber.",
    ask: "Which finding needs follow-up?",
    rationale: "Rationale",
    takeaway: "Takeaway",
    terms: [],
    table: null,
    images: [],
    question,
  };
}

const single: Question = { type: "single", options: [{ t: "Right", ok: true }, { t: "Wrong" }] };

const set: LoadedSet = {
  id: "set",
  courseId: "course",
  title: "Week 1",
  weekLabel: "Week 1",
  questions: [loaded("q1", 0, single), loaded("q2", 1, single)],
  sitting: null,
  run: null,
};

const score: Feedback = { status: "correct", points: 1, maxPoints: 1, label: "Correct", pointsText: null, ruleText: null };
const STEM_MARK: Marks = { stem: [{ start: 13, end: 34, color: "yellow" }] };
const OPTION_MARK: Marks = { ...STEM_MARK, "option:1": [{ start: 0, end: 5, color: "pink" }] };

function marked(): Session {
  const session = markAttempt(beginSession(set, "set"), 0, STEM_MARK);
  if (!session) throw new Error("the sitting did not open");
  return session;
}

describe("highlights in a practice sitting", () => {
  it("opens every question with nothing marked", () => {
    expect(beginSession(set, "set").attempts.map((attempt) => attempt.marks)).toEqual([{}, {}]);
  });

  it("keeps a question's marks on that question only", () => {
    const session = marked();
    expect(session.attempts[0]?.marks).toEqual(STEM_MARK);
    expect(session.attempts[1]?.marks).toEqual({});
  });

  it("keeps the marks after Check answer, and still lets the user mark the checked question", () => {
    const checked = reveal(marked(), 0, false, score);
    expect(checked?.attempts[0]?.marks).toEqual(STEM_MARK);
    const more = markAttempt(checked, 0, OPTION_MARK);
    expect(more?.attempts[0]?.marks).toEqual(OPTION_MARK);
    // The answer itself stays as it was checked.
    expect(more?.attempts[0]?.score).toEqual(score);
  });

  it("keeps the marks while the user moves on, and drops every one when the set ends", () => {
    const moved = advance(reveal(marked(), 0, false, score));
    expect(moved?.index).toBe(1);
    expect(moved?.attempts[0]?.marks).toEqual(STEM_MARK);
    const finished = advance(reveal(markAttempt(moved, 1, OPTION_MARK), 1, false, score));
    expect(finished?.finishedAt).not.toBeNull();
    expect(finished?.attempts.map((attempt) => attempt.marks)).toEqual([{}, {}]);
  });

  it("starts clean after Start over", () => {
    expect(startOver(marked())?.attempts.map((attempt) => attempt.marks)).toEqual([{}, {}]);
  });
});

function item(over: Partial<ItemState> = {}): ItemState {
  return {
    layout: { kind: "options", order: [0, 1] },
    draft: { type: "single", choice: null },
    struck: [],
    marks: {},
    guessed: false,
    clientAttemptId: "attempt",
    submitted: false,
    skipped: false,
    ...over,
  };
}

function run(state: RunnerState, ...events: RunnerEvent[]): RunnerState {
  return events.reduce(runnerReduce, state);
}

const markWith = (marks: Marks): RunnerEvent => ({ type: "edit", change: () => ({ marks }) });

describe("highlights in an exam", () => {
  const items = [item(), item()];
  const opened: RunnerState = { items, phase: initialPhase(items) };

  it("marks the question on screen and no other", () => {
    const state = run(opened, markWith(STEM_MARK));
    expect(state.items.map((entry) => entry.marks)).toEqual([STEM_MARK, {}]);
  });

  it("keeps the marks of a skipped question for when the user comes back to it", () => {
    const state = run(opened, markWith(STEM_MARK), { type: "skip" });
    expect(state.phase).toMatchObject({ phase: "answering", index: 1 });
    expect(state.items[0]?.marks).toEqual(STEM_MARK);
    expect(state.items[0]?.skipped).toBe(true);
  });

  it("does not mark while an answer is on its way", () => {
    const answered = run(opened, { type: "edit", change: () => ({ draft: { type: "single", choice: 0 } }) }, { type: "submit" });
    expect(answered.phase.phase).toBe("saving");
    expect(run(answered, markWith(STEM_MARK)).items[0]?.marks).toEqual({});
  });
});
