import type { SetSummary } from "../api";
import { when } from "../when";

/** "1 question", "12 questions". */
function questions(count: number): string {
  return `${String(count)} ${count === 1 ? "question" : "questions"}`;
}

/** Every question has an answer and no sitting is open: the row's Done line. */
export function isFinishedSet(set: Pick<SetSummary, "sitting" | "questionCount" | "answeredCount">): boolean {
  return set.sitting === null && set.questionCount > 0 && set.answeredCount >= set.questionCount;
}

/** The set in this course, when its row says Done. A missing course or set is not finished. */
export function practiceSetIsFinished(course: { folders: readonly { sets: readonly SetSummary[] }[] } | null, setId: string): boolean {
  if (course === null) return false;
  for (const folder of course.folders) {
    const found = folder.sets.find((item) => item.id === setId);
    if (found) return isFinishedSet(found);
  }
  return false;
}

/** A set row's line: when it arrived, how far she got, or how it went. */
export function statusLine(set: SetSummary): string {
  // Her answers this time through. Without a sitting, the counts below are every answer she has given.
  if (set.sitting !== null) return `${String(set.sitting.answeredCount)} of ${String(set.questionCount)} answered`;
  if (set.answeredCount === 0) {
    const word = set.status === "imported" ? "Imported" : set.status === "replaced" ? "Replaced" : "Restored";
    return `${word} ${when(set.activeSince)} · ${questions(set.questionCount)}`;
  }
  if (isFinishedSet(set)) {
    const finished = set.lastAnsweredAt === null ? when(set.activeSince) : when(set.lastAnsweredAt);
    return `Done ${finished} · ${String(set.fullyRightCount)} of ${String(set.questionCount)} fully right`;
  }
  return `${String(set.answeredCount)} of ${String(set.questionCount)} answered`;
}
