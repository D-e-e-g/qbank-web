// The only place a practice answer leaves the screen.

import { submitAttempt, type SavedAttempt } from "../submit-attempt";
import type { Answer, Layout } from "./model";

export interface PracticeAttemptRecord {
  /** Stable id for this opening of the question, so a retry does not double-count. */
  clientAttemptId: string;
  questionId: string;
  /** Indexes into the stored question, not into the shuffled layout. */
  response: Answer;
  guessed: boolean;
  /** The shuffle she saw, saved with the attempt. */
  layout: Layout;
  /** From the Review runner, so the answer does not read as beginning its set again. */
  fromReview: boolean;
}

/** The server's score for an answer and the feedback banner's lines for it. */
export type Feedback = Pick<SavedAttempt, "status" | "points" | "maxPoints" | "label" | "pointsText" | "ruleText">;

/**
 * Saves the answer and returns the score the server gave it, with the banner's text. The screen
 * shows those, never its own. A dropped connection is retried with the same id; `onWaiting` is
 * called while it waits. An answer the question cannot take is refused with the server's reason.
 */
export async function recordPracticeAnswer(attempt: PracticeAttemptRecord, onWaiting?: () => void): Promise<Feedback> {
  const saved = await submitAttempt(
    {
      clientAttemptId: attempt.clientAttemptId,
      questionId: attempt.questionId,
      response: attempt.response,
      guessed: attempt.guessed,
      shuffle: attempt.layout,
      ...(attempt.fromReview ? { fromReview: true } : {}),
    },
    onWaiting === undefined ? {} : { onRetry: onWaiting },
  );
  return {
    status: saved.status,
    points: saved.points,
    maxPoints: saved.maxPoints,
    label: saved.label,
    pointsText: saved.pointsText,
    ruleText: saved.ruleText,
  };
}
