import { describe, expect, it } from "vitest";
import { answeredEarlier, attemptStep, scoreOf, type AttemptEvent, type AttemptPhase, type AttemptState } from "./attempt";
import type { Marks } from "./highlight/marks";
import { toggleStrike } from "./model";
import type { Feedback } from "./recordPracticeAnswer";

const score: Feedback = { status: "incorrect", points: 0, maxPoints: 1, label: "Not correct", pointsText: null, ruleText: null };

function attempt(over: Partial<AttemptState> = {}): AttemptState {
  return {
    layout: { kind: "options", order: [0, 1, 2] },
    draft: { type: "single", choice: 1 },
    struck: [],
    marks: {},
    guessed: false,
    clientAttemptId: "attempt",
    phase: { phase: "open" },
    ...over,
  };
}

const OPEN: AttemptPhase = { phase: "open" };
const CHECKING: AttemptPhase = { phase: "checking", sent: { type: "single", choice: 1 }, retrying: false };
const RETRYING: AttemptPhase = { phase: "checking", sent: { type: "single", choice: 1 }, retrying: true };
const REVEALED: AttemptPhase = { phase: "revealed", score, earlier: false };
const EARLIER: AttemptPhase = { phase: "revealed", score: null, earlier: true };

const PICK: AttemptEvent = { type: "edit", change: () => ({ draft: { type: "single", choice: 0 } }) };
const STRIKE: AttemptEvent = { type: "edit", change: (entry) => toggleStrike(entry.draft, entry.struck, 1) };
const GUESS: AttemptEvent = { type: "edit", change: () => ({ guessed: true }) };
const MARKS: Marks = { stem: [{ start: 0, end: 4, color: "yellow" }] };
const MARK: AttemptEvent = { type: "mark", marks: MARKS };

describe("attemptStep, each transition", () => {
  it("edit: the picks, the strikes and the guess box change only while the question is open", () => {
    const open = attempt();
    expect(attemptStep(open, PICK).draft).toEqual({ type: "single", choice: 0 });
    expect(attemptStep(open, STRIKE)).toMatchObject({ draft: { type: "single", choice: null }, struck: [1] });
    expect(attemptStep(open, GUESS).guessed).toBe(true);
    for (const phase of [CHECKING, RETRYING, REVEALED, EARLIER]) {
      const closed = attempt({ phase });
      for (const event of [PICK, STRIKE, GUESS]) expect(attemptStep(closed, event)).toBe(closed);
    }
  });

  it("mark: highlights change in every phase, and never touch the answer", () => {
    for (const phase of [OPEN, CHECKING, RETRYING, REVEALED, EARLIER]) {
      const before = attempt({ phase });
      const marked = attemptStep(before, MARK);
      expect(marked).toEqual({ ...before, marks: MARKS });
      expect(marked.phase).toBe(phase);
      expect(attemptStep(marked, MARK)).toBe(marked);
    }
  });

  it("check: open to checking with the answer as it is sent, only when there is one", () => {
    expect(attemptStep(attempt(), { type: "check" }).phase).toEqual(CHECKING);
    const blank = attempt({ draft: { type: "single", choice: null } });
    expect(attemptStep(blank, { type: "check" })).toBe(blank);
    for (const phase of [CHECKING, RETRYING, REVEALED, EARLIER]) {
      const closed = attempt({ phase });
      expect(attemptStep(closed, { type: "check" })).toBe(closed);
    }
  });

  it("checkRetrying: marks the answer on its way as waiting for the connection, once", () => {
    const out = attempt({ phase: CHECKING });
    const waiting = attemptStep(out, { type: "checkRetrying" });
    expect(waiting.phase).toEqual(RETRYING);
    expect(attemptStep(waiting, { type: "checkRetrying" })).toBe(waiting);
    for (const phase of [OPEN, REVEALED, EARLIER]) {
      const other = attempt({ phase });
      expect(attemptStep(other, { type: "checkRetrying" })).toBe(other);
    }
  });

  it("checked: checking to revealed with the server's score, and no other phase takes a score", () => {
    for (const phase of [CHECKING, RETRYING]) {
      const revealed = attemptStep(attempt({ phase }), { type: "checked", score });
      expect(revealed.phase).toEqual(REVEALED);
      expect(revealed.draft).toEqual({ type: "single", choice: 1 });
    }
    for (const phase of [OPEN, REVEALED, EARLIER]) {
      const other = attempt({ phase });
      expect(attemptStep(other, { type: "checked", score: { ...score, status: "correct" } })).toBe(other);
    }
  });

  it("checkFailed: checking back to open with the answer as it was sent", () => {
    for (const phase of [CHECKING, RETRYING]) {
      expect(attemptStep(attempt({ phase }), { type: "checkFailed" })).toEqual(attempt());
    }
    for (const phase of [OPEN, REVEALED, EARLIER]) {
      const other = attempt({ phase });
      expect(attemptStep(other, { type: "checkFailed" })).toBe(other);
    }
  });
});

describe("what a question's phase says", () => {
  it("has a score only once revealed", () => {
    expect(scoreOf(attempt({ phase: OPEN }))).toBeNull();
    expect(scoreOf(attempt({ phase: CHECKING }))).toBeNull();
    expect(scoreOf(attempt({ phase: REVEALED }))).toEqual(score);
    expect(scoreOf(attempt({ phase: EARLIER }))).toBeNull();
  });

  it("is answered earlier only when it was revealed before this opening", () => {
    expect(answeredEarlier(attempt({ phase: OPEN }))).toBe(false);
    expect(answeredEarlier(attempt({ phase: REVEALED }))).toBe(false);
    expect(answeredEarlier(attempt({ phase: EARLIER }))).toBe(true);
  });
});
