// One opening of a practice set or Review: her answer to each question as she works through it,
// and the results once she reaches the end. A set she left midway opens at the first question she
// has not answered, with the answers the server kept for it already filled in. A set she has
// already finished opens at question 1 as a new run.

import { initialDraft, makeLayout, toggleStrike, type Draft, type Layout, type LoadedQuestion, type LoadedSet, type Sitting } from "./model";
import type { Feedback } from "./recordPracticeAnswer";
import type { Marks } from "./highlight/marks";
import type { StripStep } from "./RunnerShell";
import type { PracticeSource } from "./source";
import { when } from "../when";

export interface AttemptState {
  layout: Layout;
  draft: Draft;
  /** Choices she has struck out, as original option indexes. Kept for this sitting only, never sent. */
  struck: readonly number[];
  /** Words she has highlighted. Kept for this sitting only, never sent; they stay after Check answer. */
  marks: Marks;
  guessed: boolean;
  clientAttemptId: string;
  score: Feedback | null;
  /** Answered before this opening. It counts in the results, and she is not asked it again. */
  earlier: boolean;
}

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
}

function freshAttempt(question: LoadedQuestion): AttemptState {
  const layout = makeLayout(question.question);
  return {
    layout,
    draft: initialDraft(question.question, layout),
    struck: [],
    marks: {},
    guessed: false,
    clientAttemptId: crypto.randomUUID(),
    score: null,
    earlier: false,
  };
}

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
  const attempts = fresh.attempts.map((attempt, position) => {
    const id = fresh.questions[position]?.id ?? "";
    if (!answered.has(id)) return attempt;
    const answer = answers.get(id);
    if (!answer) return { ...attempt, earlier: true };
    const { clientAttemptId, guessed, status, points, maxPoints, label, pointsText, ruleText } = answer;
    return { ...attempt, earlier: true, clientAttemptId, guessed, score: { status, points, maxPoints, label, pointsText, ruleText } };
  });
  const lastAnsweredAt = sitting.answers.reduce<string | null>((latest, answer) => (latest === null || answer.answeredAt > latest ? answer.answeredAt : latest), null);
  return { ...fresh, index, attempts, pickedUp: { at: index + 1, answered: answered.size, lastAnsweredAt } };
}

/** Begins the set again at question 1, after she chose Start over. Her saved answers stay on the server. */
export function startOver(session: Session | null): Session | null {
  if (!session) return session;
  return { ...session, index: 0, pickedUp: null, startedAt: Date.now(), finishedAt: null, attempts: session.questions.map(freshAttempt) };
}

/** How many questions she has answered, in this opening and before it. */
export function answeredCount(session: Session): number {
  return session.attempts.filter((attempt) => attempt.earlier || attempt.score !== null).length;
}

/** The progress strip: each checked question's result, the one on screen, and the ones still to come. */
export function progressStrip(session: Session): StripStep[] {
  return session.attempts.map((attempt, index) => {
    if (attempt.score) return attempt.score.status === "correct" ? "right" : attempt.score.status === "partial" ? "partial" : "missed";
    if (attempt.earlier) return "answered";
    return index === session.index ? "now" : "todo";
  });
}

/** The next question she has not answered, or -1 when this is the last of them. */
export function nextIndex(session: Session): number {
  return session.attempts.findIndex((attempt, index) => index > session.index && !attempt.earlier);
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

/** Changes her answer to a question she has not checked yet. A checked one stays as it was. */
export function updateAttempt(session: Session | null, index: number, edit: (attempt: AttemptState) => AttemptState): Session | null {
  if (!session) return session;
  const attempt = session.attempts[index];
  if (!attempt || attempt.score) return session;
  const attempts = session.attempts.slice();
  attempts[index] = edit(attempt);
  return { ...session, attempts };
}

/** Strikes out a choice of a question she has not checked yet, or restores it. */
export function strike(session: Session | null, index: number, option: number): Session | null {
  return updateAttempt(session, index, (attempt) => ({ ...attempt, ...toggleStrike(attempt.draft, attempt.struck, option) }));
}

/** Replaces her highlights on a question. Unlike her answer, they can still change once it is checked. */
export function markAttempt(session: Session | null, index: number, marks: Marks): Session | null {
  if (!session) return session;
  const attempt = session.attempts[index];
  if (!attempt || attempt.marks === marks) return session;
  const attempts = session.attempts.slice();
  attempts[index] = { ...attempt, marks };
  return { ...session, attempts };
}

export function reveal(session: Session | null, index: number, guessed: boolean, score: Feedback): Session | null {
  if (!session) return session;
  const attempt = session.attempts[index];
  if (!attempt || attempt.score) return session;
  const attempts = session.attempts.slice();
  attempts[index] = { ...attempt, guessed, score };
  return { ...session, attempts };
}

/** Moves to the next question she has not answered, or past the last one to the results, where every strike and highlight is dropped. */
export function advance(session: Session | null): Session | null {
  if (!session) return session;
  const next = nextIndex(session);
  if (next !== -1) return { ...session, index: next };
  if (session.finishedAt !== null) return session;
  return { ...session, finishedAt: Date.now(), attempts: session.attempts.map((attempt) => ({ ...attempt, struck: [], marks: {} })) };
}
