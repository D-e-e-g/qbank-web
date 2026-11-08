import type { Session } from "./session";

/** Above question 1 when a finished practice set opens again. */
export const NEW_RUN_NOTICE = "You've answered this set before. Answering now starts a new practice run.";

/** Question 1 of a practice set she has already finished. Not Review, not a result, not a set still going. */
export function showNewRunNotice(session: Pick<Session, "kind" | "index" | "finishedAt" | "newRun">): boolean {
  return session.kind === "set" && session.finishedAt === null && session.index === 0 && session.newRun;
}
