import type { SetSummary } from "../api";
import { when } from "../when";

/** "1 question", "12 questions". */
function questions(count: number): string {
  return `${String(count)} ${count === 1 ? "question" : "questions"}`;
}

/** A set row's line: when it arrived, how far she got, or how it went. */
export function statusLine(set: SetSummary): string {
  // Her answers this time through. Without a sitting, the counts below are every answer she has given.
  if (set.sitting) return `${String(set.sitting.answeredCount)} of ${String(set.questionCount)} answered`;
  if (set.answeredCount === 0) {
    const word = set.status === "imported" ? "Imported" : set.status === "replaced" ? "Replaced" : "Restored";
    return `${word} ${when(set.activeSince)} · ${questions(set.questionCount)}`;
  }
  if (set.questionCount > 0 && set.answeredCount >= set.questionCount) {
    const finished = set.lastAnsweredAt === null ? when(set.activeSince) : when(set.lastAnsweredAt);
    return `Done ${finished} · ${String(set.fullyRightCount)} of ${String(set.questionCount)} fully right`;
  }
  return `${String(set.answeredCount)} of ${String(set.questionCount)} answered`;
}
