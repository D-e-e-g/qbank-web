import { describe, expect, it } from "vitest";
import type { LoadedQuestion, LoadedSet, Question, Sitting } from "./model";
import type { Feedback } from "./recordPracticeAnswer";
import { advance, answeredCount, beginSession, nextIndex, pickedUpLine, reveal, startOver, startOverMessage, strike, updateAttempt, type Session } from "./session";

type SittingAnswer = Sitting["answers"][number];

function loaded(id: string, position: number, question: Question): LoadedQuestion {
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
    question,
  };
}

const set: LoadedSet = {
  id: "set",
  courseId: "course",
  title: "Week 1",
  weekLabel: "Week 1",
  questions: [
    loaded("q1", 0, { type: "single", options: [{ t: "Right", ok: true }, { t: "Wrong" }, { t: "Also wrong" }] }),
    loaded("q2", 1, { type: "sata", options: [{ t: "Yes", ok: true }, { t: "No" }, { t: "Yes too", ok: true }] }),
  ],
  sitting: null,
  // As from a server that does not send `run` yet.
  run: null,
};

const score: Feedback = { status: "incorrect", points: 0, maxPoints: 1, label: "Not correct", pointsText: null, ruleText: null };

function started(): Session {
  return beginSession(set, "set");
}

describe("strikes in a practice sitting", () => {
  it("opens every question with nothing struck", () => {
    expect(started().attempts.map((attempt) => attempt.struck)).toEqual([[], []]);
  });

  it("strikes a choice out and restores it with the same gesture", () => {
    const struck = strike(started(), 0, 1);
    expect(struck?.attempts[0]?.struck).toEqual([1]);
    expect(strike(struck, 0, 1)?.attempts[0]?.struck).toEqual([]);
  });

  it("unpicks the choice she struck", () => {
    const picked = updateAttempt(started(), 1, (attempt) => ({ ...attempt, draft: { type: "sata", picks: [0, 1] } }));
    const struck = strike(picked, 1, 1);
    expect(struck?.attempts[1]?.draft).toEqual({ type: "sata", picks: [0] });
    expect(struck?.attempts[1]?.struck).toEqual([1]);
  });

  it("keeps each question's strikes while she moves to the next question", () => {
    const moved = advance(strike(strike(started(), 0, 2), 1, 1));
    expect(moved?.index).toBe(1);
    expect(moved?.attempts.map((attempt) => attempt.struck)).toEqual([[2], [1]]);
  });

  it("leaves strikes alone once the answer is checked", () => {
    const checked = reveal(strike(started(), 0, 1), 0, false, score);
    expect(strike(checked, 0, 1)?.attempts[0]?.struck).toEqual([1]);
    expect(strike(checked, 0, 2)).toBe(checked);
  });

  it("drops every strike when the set ends", () => {
    const last = advance(strike(strike(started(), 0, 2), 1, 1));
    const finished = advance(reveal(last, 1, false, score));
    expect(finished?.finishedAt).not.toBeNull();
    expect(finished?.attempts.map((attempt) => attempt.struck)).toEqual([[], []]);
  });
});

describe("a set she left midway", () => {
  const single: Question = { type: "single", options: [{ t: "Right", ok: true }, { t: "Wrong" }] };
  const questions = ["q1", "q2", "q3", "q4"].map((id, position) => loaded(id, position, single));

  function answer(questionId: string, overrides: Partial<SittingAnswer> = {}): SittingAnswer {
    return {
      clientAttemptId: `attempt-${questionId}`,
      questionId,
      status: "correct",
      points: 1,
      maxPoints: 1,
      guessed: false,
      answeredAt: new Date().toISOString(),
      inReview: false,
      label: "Correct",
      pointsText: null,
      ruleText: null,
      response: { type: "single", choice: 0 },
      shuffle: null,
      ...overrides,
    };
  }

  function sitting(answered: string[], answers = answered.map((id) => answer(id))): LoadedSet {
    return { ...set, questions, sitting: { id: null, startedAt: null, answeredQuestionIds: answered, answers } };
  }

  it("opens at question 1 with nothing to pick up when there is no sitting", () => {
    const session = beginSession({ ...set, questions }, "set");
    expect(session.index).toBe(0);
    expect(session.pickedUp).toBeNull();
    expect(session.newRun).toBe(false);
    expect(answeredCount(session)).toBe(0);
  });

  it("opens at the first unanswered question, with the earlier answers filled in", () => {
    const session = beginSession(sitting(["q1", "q2"], [answer("q1"), answer("q2", { status: "incorrect", points: 0, label: "Not correct", guessed: true })]), "set");
    expect(session.index).toBe(2);
    expect(session.pickedUp).toMatchObject({ at: 3, answered: 2 });
    expect(answeredCount(session)).toBe(2);
    expect(session.attempts[1]).toMatchObject({ earlier: true, guessed: true, clientAttemptId: "attempt-q2", score: { status: "incorrect", label: "Not correct" } });
    expect(session.attempts[2]).toMatchObject({ earlier: false, score: null });
  });

  it("does not ask again a question answered out of order, and ends when none is left", () => {
    const opened = beginSession(sitting(["q2", "q4"]), "set");
    expect(opened.index).toBe(0);
    expect(opened.newRun).toBe(false);
    expect(nextIndex(opened)).toBe(2);
    const moved = advance(reveal(opened, 0, false, score));
    expect(moved?.index).toBe(2);
    expect(moved && nextIndex(moved)).toBe(-1);
    const finished = advance(reveal(moved, 2, false, score));
    expect(finished?.finishedAt).not.toBeNull();
    expect(finished && answeredCount(finished)).toBe(4);
  });

  it("counts a question the server calls answered even when it sent no answer for it", () => {
    const session = beginSession(sitting(["q1", "q2"], [answer("q2")]), "set");
    expect(session.index).toBe(2);
    expect(answeredCount(session)).toBe(2);
    expect(session.attempts[0]).toMatchObject({ earlier: true, score: null });
  });

  it("opens fresh if the sitting has nothing left to answer", () => {
    const session = beginSession(sitting(["q1", "q2", "q3", "q4"]), "set");
    expect(session.index).toBe(0);
    expect(session.pickedUp).toBeNull();
    expect(session.newRun).toBe(true);
    expect(answeredCount(session)).toBe(0);
  });

  it("opens a finished set with no sitting as a new run at question 1", () => {
    const session = beginSession({ ...set, questions }, "set", true);
    expect(session.index).toBe(0);
    expect(session.pickedUp).toBeNull();
    expect(session.newRun).toBe(true);
    expect(answeredCount(session)).toBe(0);
  });

  it("does not call a set she left midway a new run", () => {
    const session = beginSession(sitting(["q1", "q2"]), "set", true);
    expect(session.index).toBe(2);
    expect(session.newRun).toBe(false);
  });

  it("starts over at question 1 with nothing filled in and new attempt ids", () => {
    const opened = beginSession(sitting(["q1", "q2"]), "set");
    const again = startOver(opened);
    expect(again?.index).toBe(0);
    expect(again?.pickedUp).toBeNull();
    expect(again?.newRun).toBe(false);
    expect(again?.finishedAt).toBeNull();
    expect(again && answeredCount(again)).toBe(0);
    expect(again?.attempts[0]?.clientAttemptId).not.toBe("attempt-q1");
  });

  describe("where the server's run puts her", () => {
    it("opens a new set at question 1, whatever the course row said", () => {
      const session = beginSession({ ...set, questions, run: "new" }, "set", true);
      expect(session.index).toBe(0);
      expect(session.pickedUp).toBeNull();
      expect(session.newRun).toBe(false);
    });

    it("opens a set she began again at question 1, not as a new run, even beside a sitting", () => {
      const session = beginSession({ ...sitting(["q1", "q2"]), run: "restarted" }, "set", true);
      expect(session.index).toBe(0);
      expect(session.pickedUp).toBeNull();
      expect(session.newRun).toBe(false);
      expect(answeredCount(session)).toBe(0);
    });

    it("opens a done set as a new run at question 1 with no course row, even with a retake under way", () => {
      for (const loaded of [{ ...set, questions, run: "done" as const }, { ...sitting(["q1"]), run: "done" as const }]) {
        const session = beginSession(loaded, "set");
        expect(session.index).toBe(0);
        expect(session.pickedUp).toBeNull();
        expect(session.newRun).toBe(true);
        expect(answeredCount(session)).toBe(0);
      }
    });

    it("picks a midway set up where she left it, and never calls it a new run", () => {
      const session = beginSession({ ...sitting(["q1", "q2"]), run: "midway" }, "set", true);
      expect(session.index).toBe(2);
      expect(session.pickedUp).toMatchObject({ at: 3, answered: 2 });
      expect(session.newRun).toBe(false);
    });

    it("opens a midway set at question 1 when no sitting came with it", () => {
      const session = beginSession({ ...set, questions, run: "midway" }, "set", true);
      expect(session.index).toBe(0);
      expect(session.pickedUp).toBeNull();
      expect(session.newRun).toBe(false);
    });
  });

  it("says how many she answered earlier today, and the day when it was another day", () => {
    const today = new Date().toISOString();
    expect(pickedUpLine({ at: 8, answered: 7, lastAnsweredAt: today })).toBe("Picked up at 8 · 7 answered earlier");
    expect(pickedUpLine({ at: 8, answered: 7, lastAnsweredAt: "2020-10-20T12:00:00Z" })).toMatch(/^Picked up at 8 · last answered \S+ \d+$/);
  });

  it("asks Start over with her own count", () => {
    expect(startOverMessage(7)).toBe("Your 7 answers stay saved and still count. The set begins again at question 1.");
    expect(startOverMessage(1)).toBe("Your 1 answer stays saved and still counts. The set begins again at question 1.");
  });
});
