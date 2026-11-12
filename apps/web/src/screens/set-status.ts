import type { SetRun, SetSummary } from "../api";
import { when } from "../when";

/** "1 question", "12 questions". */
function questions(count: number): string {
  return `${String(count)} ${count === 1 ? "question" : "questions"}`;
}

type RunFields = Pick<SetSummary, "run" | "sitting" | "questionCount" | "answeredCount">;

/**
 * Where she stands in the set: the server's `run`. A server that does not send it yet leaves the
 * screens to read the counts as they did before: a sitting to continue, nothing answered, every
 * question answered, or answers kept with the set opening at question 1 again.
 */
export function setRun(set: RunFields): SetRun {
  if (set.run !== undefined) return set.run;
  if (set.sitting !== null) return "midway";
  if (set.answeredCount === 0) return "new";
  if (set.questionCount > 0 && set.answeredCount >= set.questionCount) return "done";
  return "restarted";
}

/** The row says Done. */
export function isFinishedSet(set: RunFields): boolean {
  return setRun(set) === "done";
}

/** The row offers Continue: opening the set picks up where she left off. */
export function offersContinue(set: RunFields): boolean {
  return setRun(set) === "midway";
}

/**
 * The set in this course, when its row says Done. A missing course or set is not finished.
 * Only for a practice set read from a server that does not send its `run`.
 */
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
  switch (setRun(set)) {
    case "new": {
      const word = set.status === "imported" ? "Imported" : set.status === "replaced" ? "Replaced" : "Restored";
      return `${word} ${when(set.activeSince)} · ${questions(set.questionCount)}`;
    }
    case "midway":
      // Her answers this time through.
      return `${String(set.sitting?.answeredCount ?? set.answeredCount)} of ${String(set.questionCount)} answered`;
    case "done": {
      const finished = set.lastAnsweredAt === null ? when(set.activeSince) : when(set.lastAnsweredAt);
      return `Done ${finished} · ${String(set.fullyRightCount)} of ${String(set.questionCount)} fully right`;
    }
    case "restarted":
      // Every answer she has given: the set opens at question 1, and they all still count.
      return `${String(set.answeredCount)} of ${String(set.questionCount)} answered`;
  }
}
