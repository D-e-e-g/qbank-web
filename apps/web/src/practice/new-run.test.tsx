import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LoadedQuestion, LoadedSet, Question, Sitting } from "./model";
import { NewRunNotice } from "./NewRunNotice";
import { NEW_RUN_NOTICE } from "./new-run";
import type { Feedback } from "./recordPracticeAnswer";
import { beginSession, practiceStep, type PracticeEvent, type Session } from "./session";

type SittingAnswer = Sitting["answers"][number];

const NOTICE = "You've answered this set before. Answering now starts a new practice run.";

function loaded(id: string): LoadedQuestion {
  const question: Question = { type: "single", options: [{ t: "Right", ok: true }, { t: "Wrong" }] };
  return {
    id,
    publicId: id,
    position: id === "q1" ? 0 : 1,
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

const questions = [loaded("q1"), loaded("q2")];

const openSet: LoadedSet = {
  id: "set",
  courseId: "course",
  title: "Week 1",
  weekLabel: "Week 1",
  questions,
  sitting: null,
  run: null,
};

const score: Feedback = { status: "correct", points: 1, maxPoints: 1, label: "Correct", pointsText: null, ruleText: null };

function answer(questionId: string): SittingAnswer {
  return {
    clientAttemptId: `attempt-${questionId}`,
    questionId,
    status: "correct",
    points: 1,
    maxPoints: 1,
    guessed: false,
    answeredAt: "2026-11-08T12:00:00.000Z",
    inReview: false,
    label: "Correct",
    pointsText: null,
    ruleText: null,
    response: { type: "single", choice: 0 },
    shuffle: null,
  };
}

function sitting(answered: string[]): LoadedSet {
  return { ...openSet, run: "midway", sitting: { id: null, startedAt: null, answeredQuestionIds: answered, answers: answered.map(answer) } };
}

function run(session: Session, ...events: PracticeEvent[]): Session {
  return events.reduce(practiceStep, session);
}

/** Answers the question on screen and takes the server's score for it. */
function check(session: Session): Session {
  const clientAttemptId = session.attempts[session.index]?.clientAttemptId ?? "";
  return run(session, { type: "edit", change: () => ({ draft: { type: "single", choice: 0 } }) }, { type: "check" }, { type: "checked", clientAttemptId, score });
}

/** The rendered notice, with the text apostrophe put back. An empty string is no notice. */
function markup(session: Session): string {
  return renderToStaticMarkup(<NewRunNotice session={session} />).replaceAll("&#x27;", "'");
}

describe("NewRunNotice", () => {
  it("uses those words exactly", () => {
    expect(NEW_RUN_NOTICE).toBe(NOTICE);
  });

  it("shows them above question 1 of a finished set, as text with nothing to tap", () => {
    const html = markup(beginSession({ ...openSet, run: "done" }, "set"));
    expect(html).toBe(`<p class="runner-new-run">${NOTICE}</p>`);
  });

  it("does not show on a set not yet started", () => {
    expect(markup(beginSession({ ...openSet, run: "new" }, "set"))).toBe("");
  });

  it("does not show while she continues, including when that opens at question 1", () => {
    expect(markup(beginSession(sitting(["q1"]), "set"))).toBe("");
    expect(markup(beginSession(sitting(["q2"]), "set"))).toBe("");
  });

  it("does not show in Review", () => {
    expect(markup(beginSession({ ...openSet, run: "done" }, "review"))).toBe("");
    expect(markup(beginSession({ ...sitting(["q1", "q2"]), run: null }, "review"))).toBe("");
  });

  it("does not show after Start over on a set she had not finished", () => {
    const again = run(beginSession(sitting(["q1"]), "set"), { type: "startOver" }, { type: "startedOver" });
    expect(again.index).toBe(0);
    expect(again.pickedUp).toBeNull();
    expect(markup(again)).toBe("");
  });

  it("stays on question 1 after she checks the answer, and leaves once the runner moves on", () => {
    const opened = beginSession({ ...openSet, run: "done" }, "set");
    const checked = check(opened);
    expect(markup(checked)).toBe(`<p class="runner-new-run">${NOTICE}</p>`);
    const next = run(checked, { type: "next" });
    expect(next.index).toBe(1);
    expect(next.finishedAt).toBeNull();
    expect(markup(next)).toBe("");
    const done = run(check(next), { type: "next" });
    expect(done.finishedAt).not.toBeNull();
    expect(markup(done)).toBe("");
  });
});
