// One opening of a practice set or Review: her answer to each question as she works through it,
// and the results once she reaches the end. A set she left midway opens at the first question she
// has not answered, with the answers the server kept for it already filled in. A set she has
// already finished opens at question 1 as a new run.

import { answeredEarlier, attemptStep, freshAttempt, scoreOf, type AttemptEvent, type AttemptState } from "./attempt";
import type { LoadedQuestion, LoadedSet, Sitting } from "./model";
import type { Feedback } from "./recordPracticeAnswer";
import type { StripStep } from "./RunnerShell";
import type { PracticeSource } from "./source";
import { when } from "../when";

/** Where a set she came back to opened. */
export interface PickedUp {
  /** The question it opened at, counted from 1. */
  at: number;
  /** How many of its questions she had already answered. */
  answered: number;
  /** When she last answered one of them. */
  lastAnsweredAt: string | null;
}

export interface Session {
  title: string;
  kind: PracticeSource["kind"];
  courseId: string;
  questions: LoadedQuestion[];
  attempts: AttemptState[];
  index: number;
  /** Null when it opened at question 1 with nothing answered. */
  pickedUp: PickedUp | null;
  /** This opening is a new run of a set she has already finished. */
  newRun: boolean;
  startedAt: number;
  finishedAt: number | null;
  /** The request to begin the set again is on its way. Until it lands, no question takes an answer, a check or Next. */
  startingOver: boolean;
  /** Why the last check or Start over failed, in the server's words, until the next one is asked. */
  error: string | null;
}

/** Everything that happens to an open practice set. Answers, checks and Next act on the question on screen. */
export type PracticeEvent =
  /** Change the picks, the strikes or the guess box. Refused unless the question is open. */
  | Extract<AttemptEvent, { type: "edit" }>
  /** Replace the highlights. Unlike the answer, they can change once the question is checked. */
  | Extract<AttemptEvent, { type: "mark" }>
  /** Send the answer to be scored. Refused unless the question is open and has an answer. */
  | { type: "check" }
  /** The request for that attempt failed on the network and is tried again. */
  | { type: "checkRetrying"; clientAttemptId: string }
  /** The server scored and saved that attempt. A reply for an attempt that is not being checked changes nothing. */
  | { type: "checked"; clientAttemptId: string; score: Feedback }
  /** The server refused that attempt, with its sentence. */
  | { type: "checkFailed"; clientAttemptId: string; message: string }
  /** Leave a checked question for the next one not answered, or for the results. */
  | { type: "next" }
  /** Ask to begin the set again at question 1. Refused while an answer is on its way. */
  | { type: "startOver" }
  /** The server began the set again. */
  | { type: "startedOver" }
  /** The server did not begin it again, with its sentence. */
  | { type: "startOverFailed"; message: string };

/**
 * Opens the set where the server's `run` puts her: a set she left midway at the first question she
 * has not answered, a finished one at question 1 as a new run, and any other at question 1.
 */
export function beginSession(loaded: LoadedSet, kind: PracticeSource["kind"]): Session {
  const fresh: Session = {
    title: loaded.title,
    kind,
    courseId: loaded.courseId,
    questions: loaded.questions,
    index: 0,
    pickedUp: null,
    newRun: false,
    startedAt: Date.now(),
    finishedAt: null,
    startingOver: false,
    error: null,
    attempts: loaded.questions.map(freshAttempt),
  };
  const sitting = loaded.sitting;
  switch (loaded.run) {
    case "new":
    case "restarted":
    case null:
      return fresh;
    case "done":
      return { ...fresh, newRun: true };
    case "midway":
      return (sitting && pickUp(fresh, sitting)) ?? fresh;
  }
}

/** The opening at the first question her sitting has no answer to, with its answers filled in. Null when there is none to pick up. */
function pickUp(fresh: Session, sitting: Sitting): Session | null {
  const answered = new Set(sitting.answeredQuestionIds);
  const answers = new Map(sitting.answers.map((answer) => [answer.questionId, answer]));
  const index = fresh.questions.findIndex((question) => !answered.has(question.id));
  if (answered.size === 0 || index === -1) return null;
  const attempts = fresh.attempts.map((attempt, position): AttemptState => {
    const id = fresh.questions[position]?.id ?? "";
    if (!answered.has(id)) return attempt;
    const answer = answers.get(id);
    if (!answer) return { ...attempt, phase: { phase: "revealed", score: null, earlier: true } };
    const { clientAttemptId, guessed, status, points, maxPoints, label, pointsText, ruleText } = answer;
    return { ...attempt, clientAttemptId, guessed, phase: { phase: "revealed", score: { status, points, maxPoints, label, pointsText, ruleText }, earlier: true } };
  });
  const lastAnsweredAt = sitting.answers.reduce<string | null>((latest, answer) => (latest === null || answer.answeredAt > latest ? answer.answeredAt : latest), null);
  return { ...fresh, index, attempts, pickedUp: { at: index + 1, answered: answered.size, lastAnsweredAt } };
}

/**
 * The set after `event`. Returns `session` itself when the event is refused or changes nothing.
 * Every change to a question goes through its own phase (attemptStep), so an answer changes only
 * while its question is open; this adds what belongs to the set: one request on its way at a time,
 * Next, and Start over.
 */
export function practiceStep(session: Session, event: PracticeEvent): Session {
  const running = session.finishedAt === null;
  switch (event.type) {
    case "edit":
      return running && !session.startingOver ? stepAttempt(session, session.index, event) : session;
    case "mark":
      return running ? stepAttempt(session, session.index, event) : session;
    case "check": {
      if (!running || session.startingOver) return session;
      const checking = stepAttempt(session, session.index, event);
      return checking === session ? session : { ...checking, error: null };
    }
    case "checkRetrying":
    case "checked":
      return stepAttempt(session, attemptIndex(session, event.clientAttemptId), event);
    case "checkFailed": {
      const open = stepAttempt(session, attemptIndex(session, event.clientAttemptId), event);
      return open === session ? session : { ...open, error: event.message };
    }
    case "next": {
      if (!running || session.startingOver || session.attempts[session.index]?.phase.phase !== "revealed") return session;
      const next = nextIndex(session);
      if (next !== -1) return { ...session, index: next };
      // Past the last one to the results, where every strike and highlight is dropped.
      return { ...session, finishedAt: Date.now(), attempts: session.attempts.map((attempt) => ({ ...attempt, struck: [], marks: {} })) };
    }
    case "startOver":
      // A score still on its way belongs to this run: it lands first, never in the new one.
      if (!running || session.startingOver || session.attempts.some((attempt) => attempt.phase.phase === "checking")) return session;
      return { ...session, startingOver: true, error: null };
    case "startedOver":
      if (!session.startingOver) return session;
      // The set begins again at question 1. The saved answers stay on the server.
      return { ...session, index: 0, pickedUp: null, startedAt: Date.now(), finishedAt: null, startingOver: false, attempts: session.questions.map(freshAttempt) };
    case "startOverFailed":
      return session.startingOver ? { ...session, startingOver: false, error: event.message } : session;
  }
}

function stepAttempt(session: Session, index: number, event: AttemptEvent): Session {
  const attempt = session.attempts[index];
  if (!attempt) return session;
  const stepped = attemptStep(attempt, event);
  if (stepped === attempt) return session;
  const attempts = session.attempts.slice();
  attempts[index] = stepped;
  return { ...session, attempts };
}

/** Where that attempt is in this run, or -1: a reply to an attempt of a run begun again finds none. */
function attemptIndex(session: Session, clientAttemptId: string): number {
  return session.attempts.findIndex((attempt) => attempt.clientAttemptId === clientAttemptId);
}

/** How many questions she has answered, in this opening and before it. */
export function answeredCount(session: Session): number {
  return session.attempts.filter((attempt) => attempt.phase.phase === "revealed").length;
}

/** The progress strip: each checked question's result, the one on screen, and the ones still to come. */
export function progressStrip(session: Session): StripStep[] {
  return session.attempts.map((attempt, index) => {
    const score = scoreOf(attempt);
    if (score) return score.status === "correct" ? "right" : score.status === "partial" ? "partial" : "missed";
    if (answeredEarlier(attempt)) return "answered";
    return index === session.index ? "now" : "todo";
  });
}

/** The next question she has not answered, or -1 when this is the last of them. */
export function nextIndex(session: Session): number {
  return session.attempts.findIndex((attempt, index) => index > session.index && !answeredEarlier(attempt));
}

/** The line under the title: how many she answered earlier, or the day she last answered if that was not today. */
export function pickedUpLine(pickedUp: PickedUp): string {
  const lastDay = pickedUp.lastAnsweredAt === null ? "today" : when(pickedUp.lastAnsweredAt);
  const detail = lastDay === "today" ? `${String(pickedUp.answered)} answered earlier` : `last answered ${lastDay}`;
  return `Picked up at ${String(pickedUp.at)} · ${detail}`;
}

/** What Start over asks, with her own count. */
export function startOverMessage(answered: number): string {
  const kept = answered === 1 ? "Your 1 answer stays saved and still counts." : `Your ${String(answered)} answers stay saved and still count.`;
  return `${kept} The set begins again at question 1.`;
}
