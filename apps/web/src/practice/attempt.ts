// One question of a practice sitting: the answer being worked on, and the one phase it is in.

import { initialDraft, makeLayout, toResponse, type Answer, type Draft, type Layout, type LoadedQuestion } from "./model";
import type { Feedback } from "./recordPracticeAnswer";
import type { Marks } from "./highlight/marks";

/**
 * Where one question is. One value, so a state such as "its score is on its way and its picks are
 * changing" cannot be written.
 * - open: being answered. Only here do the picks, the strikes and the guess box change.
 * - checking: `sent` is on its way to be scored and saved; `retrying` while the connection is down.
 *   The score that comes back is for `sent`, so the answer on screen stays as it was sent.
 * - revealed: answered. `score` is the server's. It is null only for a question answered before
 *   this opening (`earlier`) whose answer the server did not send.
 */
export type AttemptPhase =
  | { phase: "open" }
  | { phase: "checking"; sent: Answer; retrying: boolean }
  | { phase: "revealed"; score: Feedback | null; earlier: boolean };

export interface AttemptState {
  layout: Layout;
  draft: Draft;
  /** Choices struck out, as original option indexes. Kept for this sitting only, never sent. */
  struck: readonly number[];
  /** Words highlighted. Kept for this sitting only, never sent; they stay after Check answer. */
  marks: Marks;
  guessed: boolean;
  clientAttemptId: string;
  phase: AttemptPhase;
}

export type AttemptEvent =
  /** Change the picks, the strikes or the guess box. Refused unless the question is open. */
  | { type: "edit"; change: (attempt: AttemptState) => Partial<Pick<AttemptState, "draft" | "struck" | "guessed">> }
  /** Replace the highlights. Unlike the answer, they can change in every phase. */
  | { type: "mark"; marks: Marks }
  /** Send the answer to be scored. Refused unless the question is open and has an answer. */
  | { type: "check" }
  /** The answer's request failed on the network and is tried again. */
  | { type: "checkRetrying" }
  /** The server scored and saved the answer that was sent. */
  | { type: "checked"; score: Feedback }
  /** The server refused the answer: the question is open again, as it was sent. */
  | { type: "checkFailed" };

export function freshAttempt(question: LoadedQuestion): AttemptState {
  const layout = makeLayout(question.question);
  return {
    layout,
    draft: initialDraft(question.question, layout),
    struck: [],
    marks: {},
    guessed: false,
    clientAttemptId: crypto.randomUUID(),
    phase: { phase: "open" },
  };
}

/** The question after `event`. Returns `attempt` itself when the event is refused or changes nothing. */
export function attemptStep(attempt: AttemptState, event: AttemptEvent): AttemptState {
  const { phase } = attempt;
  switch (event.type) {
    case "edit":
      return phase.phase === "open" ? { ...attempt, ...event.change(attempt) } : attempt;
    case "mark":
      return attempt.marks === event.marks ? attempt : { ...attempt, marks: event.marks };
    case "check": {
      const sent = phase.phase === "open" ? toResponse(attempt.draft) : null;
      return sent === null ? attempt : { ...attempt, phase: { phase: "checking", sent, retrying: false } };
    }
    case "checkRetrying":
      return phase.phase === "checking" && !phase.retrying ? { ...attempt, phase: { ...phase, retrying: true } } : attempt;
    case "checked":
      return phase.phase === "checking" ? { ...attempt, phase: { phase: "revealed", score: event.score, earlier: false } } : attempt;
    case "checkFailed":
      return phase.phase === "checking" ? { ...attempt, phase: { phase: "open" } } : attempt;
  }
}

/** The server's score for an answered question, or null: not answered yet, or answered earlier with no answer sent back. */
export function scoreOf(attempt: AttemptState): Feedback | null {
  return attempt.phase.phase === "revealed" ? attempt.phase.score : null;
}

/** Answered before this opening. It counts in the results, and is not asked again. */
export function answeredEarlier(attempt: AttemptState): boolean {
  return attempt.phase.phase === "revealed" && attempt.phase.earlier;
}
