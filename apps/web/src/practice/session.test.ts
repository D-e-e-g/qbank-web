import { describe, expect, it } from "vitest";
import type { LoadedQuestion, LoadedSet, Question, Sitting } from "./model";
import type { Feedback } from "./recordPracticeAnswer";
import { scoreOf } from "./attempt";
import { toggleStrike } from "./model";
import { answeredCount, beginSession, nextIndex, pickedUpLine, practiceStep, startOverMessage, type PracticeEvent, type Session } from "./session";

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
  run: null,
};

const score: Feedback = { status: "incorrect", points: 0, maxPoints: 1, label: "Not correct", pointsText: null, ruleText: null };

function started(): Session {
  return beginSession(set, "set");
}

function run(session: Session, ...events: PracticeEvent[]): Session {
  return events.reduce(practiceStep, session);
}

/** A tap on a choice of the single-answer question on screen. */
const pick = (choice: number): PracticeEvent => ({ type: "edit", change: () => ({ draft: { type: "single", choice } }) });
/** A tap on the choices of the select-all question on screen. */
const pickAll = (picks: number[]): PracticeEvent => ({ type: "edit", change: () => ({ draft: { type: "sata", picks } }) });
const strike = (option: number): PracticeEvent => ({ type: "edit", change: (attempt) => toggleStrike(attempt.draft, attempt.struck, option) });
const guess = (guessed: boolean): PracticeEvent => ({ type: "edit", change: () => ({ guessed }) });
const CHECK: PracticeEvent = { type: "check" };
const NEXT: PracticeEvent = { type: "next" };

/** The id of the attempt on screen, which every reply to its check carries. */
function attemptId(session: Session): string {
  return session.attempts[session.index]?.clientAttemptId ?? "";
}

/** The answer on its way for the question on screen, or null when none is. */
function sentOf(session: Session): unknown {
  const phase = session.attempts[session.index]?.phase;
  return phase?.phase === "checking" ? phase.sent : null;
}

/** The server's score for the answer on its way. */
function scored(session: Session, feedback: Feedback = score): Session {
  return run(session, { type: "checked", clientAttemptId: attemptId(session), score: feedback });
}

/** Answers the question on screen, whichever kind it is, and takes the server's score for it. */
function check(session: Session, feedback: Feedback = score): Session {
  const draft = session.attempts[session.index]?.draft;
  const answered = draft?.type === "sata" && draft.picks.length === 0 ? run(session, pickAll([0])) : draft?.type === "single" && draft.choice === null ? run(session, pick(0)) : session;
  return scored(run(answered, CHECK), feedback);
}

describe("strikes in a practice sitting", () => {
  it("opens every question with nothing struck", () => {
    expect(started().attempts.map((attempt) => attempt.struck)).toEqual([[], []]);
  });

  it("strikes a choice out and restores it with the same gesture", () => {
    const struck = run(started(), strike(1));
    expect(struck.attempts[0]?.struck).toEqual([1]);
    expect(run(struck, strike(1)).attempts[0]?.struck).toEqual([]);
  });

  it("unpicks the choice she struck", () => {
    const second = run(check(started()), NEXT);
    const struck = run(second, pickAll([0, 1]), strike(1));
    expect(struck.attempts[1]?.draft).toEqual({ type: "sata", picks: [0] });
    expect(struck.attempts[1]?.struck).toEqual([1]);
  });

  it("keeps each question's strikes while she moves to the next question", () => {
    const moved = run(check(run(started(), strike(2))), NEXT, strike(1));
    expect(moved.index).toBe(1);
    expect(moved.attempts.map((attempt) => attempt.struck)).toEqual([[2], [1]]);
  });

  it("leaves strikes alone once the answer is checked", () => {
    const checked = check(run(started(), strike(1)));
    expect(run(checked, strike(1))).toBe(checked);
    expect(run(checked, strike(2))).toBe(checked);
    expect(checked.attempts[0]?.struck).toEqual([1]);
  });

  it("drops every strike when the set ends", () => {
    const last = run(check(run(started(), strike(2))), NEXT, strike(1));
    const finished = run(check(last), NEXT);
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.attempts.map((attempt) => attempt.struck)).toEqual([[], []]);
  });
});

describe("a score on its way", () => {
  /** Question 1 with the wrong choice picked and Check answer tapped: the reply has not come. */
  function checking(): Session {
    return run(started(), pick(1), CHECK);
  }

  it("holds the answer that was sent while the question is being checked", () => {
    const out = checking();
    expect(out.attempts[0]?.phase).toEqual({ phase: "checking", sent: { type: "single", choice: 1 }, retrying: false });
  });

  it("takes no other pick while the score is on its way, so the score lands on the answer that was sent", () => {
    const out = checking();
    expect(run(out, pick(0))).toBe(out);
    const revealed = scored(run(out, pick(0)));
    expect(revealed.attempts[0]?.draft).toEqual({ type: "single", choice: 1 });
    expect(revealed.attempts[0] && scoreOf(revealed.attempts[0])).toEqual(score);
  });

  it("takes no strike while the score is on its way, so the pick that was sent is not unpicked", () => {
    const out = checking();
    expect(run(out, strike(1))).toBe(out);
    expect(run(out, strike(2))).toBe(out);
    expect(scored(run(out, strike(1))).attempts[0]).toMatchObject({ draft: { type: "single", choice: 1 }, struck: [] });
  });

  it("leaves the guess box as it was sent", () => {
    const out = run(started(), pick(1), guess(true), CHECK);
    expect(run(out, guess(false))).toBe(out);
    expect(scored(out).attempts[0]?.guessed).toBe(true);
  });

  it("stays as sent while the connection is down, and is not posted a second time", () => {
    const out = checking();
    const waiting = run(out, { type: "checkRetrying", clientAttemptId: attemptId(out) });
    expect(waiting.attempts[0]?.phase).toEqual({ phase: "checking", sent: { type: "single", choice: 1 }, retrying: true });
    // The screen posts the answer when `sent` changes, so a retry must keep it the very same value.
    expect(sentOf(out)).not.toBeNull();
    expect(sentOf(waiting)).toBe(sentOf(out));
    expect(sentOf(run(waiting, { type: "mark", marks: { stem: [{ start: 0, end: 4, color: "yellow" }] } }))).toBe(sentOf(out));
    expect(run(waiting, pick(0), strike(1), guess(true))).toBe(waiting);
    expect(run(waiting, { type: "checkRetrying", clientAttemptId: attemptId(waiting) })).toBe(waiting);
  });

  it("does not send a second check, move on, or start over while the score is on its way", () => {
    const out = checking();
    expect(run(out, CHECK)).toBe(out);
    expect(run(out, NEXT)).toBe(out);
    expect(run(out, { type: "startOver" })).toBe(out);
  });

  it("opens the question again, as it was sent, when the server refuses the answer", () => {
    const out = checking();
    const refused = run(out, { type: "checkFailed", clientAttemptId: attemptId(out), message: "That answer does not fit this question." });
    expect(refused.attempts[0]?.phase).toEqual({ phase: "open" });
    expect(refused.attempts[0]?.draft).toEqual({ type: "single", choice: 1 });
    expect(refused.error).toBe("That answer does not fit this question.");
    // Open again: the answer can change, and checking again clears the sentence.
    const again = run(refused, pick(0), CHECK);
    expect(again.attempts[0]?.phase).toEqual({ phase: "checking", sent: { type: "single", choice: 0 }, retrying: false });
    expect(again.error).toBeNull();
  });

  it("does not check a question with no answer, or one already checked", () => {
    const blank = started();
    expect(run(blank, CHECK)).toBe(blank);
    const checked = check(started());
    expect(run(checked, CHECK)).toBe(checked);
    expect(run(checked, pick(1), guess(true))).toBe(checked);
  });

  it("ignores a reply for an attempt that is not being checked", () => {
    const open = run(started(), pick(1));
    expect(scored(open)).toBe(open);
    const out = checking();
    expect(run(out, { type: "checked", clientAttemptId: "another-attempt", score })).toBe(out);
    expect(run(out, { type: "checkFailed", clientAttemptId: "another-attempt", message: "No." })).toBe(out);
    const checked = scored(out);
    expect(scored(checked, { ...score, status: "correct" })).toBe(checked);
  });

  it("moves on only from a checked question", () => {
    const open = run(started(), pick(1));
    expect(run(open, NEXT)).toBe(open);
    expect(run(check(open), NEXT).index).toBe(1);
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
    return { ...set, questions, run: "midway", sitting: { id: null, startedAt: null, answeredQuestionIds: answered, answers } };
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
    expect(session.attempts[1]).toMatchObject({
      guessed: true,
      clientAttemptId: "attempt-q2",
      phase: { phase: "revealed", earlier: true, score: { status: "incorrect", label: "Not correct" } },
    });
    expect(session.attempts[2]?.phase).toEqual({ phase: "open" });
  });

  it("does not ask again a question answered out of order, and ends when none is left", () => {
    const opened = beginSession(sitting(["q2", "q4"]), "set");
    expect(opened.index).toBe(0);
    expect(opened.newRun).toBe(false);
    expect(nextIndex(opened)).toBe(2);
    const moved = run(check(opened), NEXT);
    expect(moved.index).toBe(2);
    expect(nextIndex(moved)).toBe(-1);
    const finished = run(check(moved), NEXT);
    expect(finished.finishedAt).not.toBeNull();
    expect(answeredCount(finished)).toBe(4);
  });

  it("counts a question the server calls answered even when it sent no answer for it", () => {
    const session = beginSession(sitting(["q1", "q2"], [answer("q2")]), "set");
    expect(session.index).toBe(2);
    expect(answeredCount(session)).toBe(2);
    expect(session.attempts[0]?.phase).toEqual({ phase: "revealed", score: null, earlier: true });
  });

  it("opens a set with no run, as in Review, at question 1 even beside a sitting", () => {
    const session = beginSession({ ...sitting(["q1", "q2"]), run: null }, "review");
    expect(session.index).toBe(0);
    expect(session.pickedUp).toBeNull();
    expect(session.newRun).toBe(false);
    expect(answeredCount(session)).toBe(0);
  });

  it("starts over at question 1 with nothing filled in and new attempt ids", () => {
    const opened = beginSession(sitting(["q1", "q2"]), "set");
    const asked = run(opened, { type: "startOver" });
    expect(asked.startingOver).toBe(true);
    expect(asked.index).toBe(2);
    const again = run(asked, { type: "startedOver" });
    expect(again.startingOver).toBe(false);
    expect(again.index).toBe(0);
    expect(again.pickedUp).toBeNull();
    expect(again.newRun).toBe(false);
    expect(again.finishedAt).toBeNull();
    expect(answeredCount(again)).toBe(0);
    expect(again.attempts[0]?.clientAttemptId).not.toBe("attempt-q1");
  });

  it("takes no answer, check or Next while Start over is on its way", () => {
    const opened = run(beginSession(sitting(["q1", "q2"]), "set"), pick(1));
    const asked = run(opened, { type: "startOver" });
    expect(run(asked, pick(0), strike(1), guess(true), CHECK, NEXT, { type: "startOver" })).toBe(asked);
    // The run begun again never takes a score from the one before it.
    const again = run(asked, { type: "startedOver" });
    expect(run(again, { type: "checked", clientAttemptId: attemptId(opened), score })).toBe(again);
  });

  it("keeps the set where it was, with the server's sentence, when Start over fails", () => {
    const opened = run(beginSession(sitting(["q1", "q2"]), "set"), pick(1));
    const failed = run(opened, { type: "startOver" }, { type: "startOverFailed", message: "Could not start over." });
    expect(failed).toEqual({ ...opened, error: "Could not start over." });
    // Asking again clears the sentence; a reply with nothing asked changes nothing.
    expect(run(failed, { type: "startOver" }).error).toBeNull();
    expect(run(opened, { type: "startedOver" })).toBe(opened);
    expect(run(opened, { type: "startOverFailed", message: "No." })).toBe(opened);
  });

  describe("where the server's run puts her", () => {
    it("opens a new set at question 1", () => {
      const session = beginSession({ ...set, questions, run: "new" }, "set");
      expect(session.index).toBe(0);
      expect(session.pickedUp).toBeNull();
      expect(session.newRun).toBe(false);
    });

    it("opens a set she began again at question 1, not as a new run, even beside a sitting", () => {
      const session = beginSession({ ...sitting(["q1", "q2"]), run: "restarted" }, "set");
      expect(session.index).toBe(0);
      expect(session.pickedUp).toBeNull();
      expect(session.newRun).toBe(false);
      expect(answeredCount(session)).toBe(0);
    });

    it("opens a done set as a new run at question 1 even with a retake under way", () => {
      for (const loaded of [{ ...set, questions, run: "done" as const }, { ...sitting(["q1"]), run: "done" as const }]) {
        const session = beginSession(loaded, "set");
        expect(session.index).toBe(0);
        expect(session.pickedUp).toBeNull();
        expect(session.newRun).toBe(true);
        expect(answeredCount(session)).toBe(0);
      }
    });

    it("picks a midway set up where she left it, and never calls it a new run", () => {
      const session = beginSession({ ...sitting(["q1", "q2"]), run: "midway" }, "set");
      expect(session.index).toBe(2);
      expect(session.pickedUp).toMatchObject({ at: 3, answered: 2 });
      expect(session.newRun).toBe(false);
    });

    it("opens a midway set at question 1 when no sitting came with it", () => {
      const session = beginSession({ ...set, questions, run: "midway" }, "set");
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
