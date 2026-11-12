import type { SetRun, SetSummary } from "../api";
import { when } from "../when";

/** "1 question", "12 questions". */
function questions(count: number): string {
  return `${String(count)} ${count === 1 ? "question" : "questions"}`;
}

type RunFields = Pick<SetSummary, "run">;

/** Where she stands in the set: the server's `run`. */
export function setRun(set: RunFields): SetRun {
  return set.run;
}

/** The row says Done. */
export function isFinishedSet(set: RunFields): boolean {
  return setRun(set) === "done";
}

/** The row offers Continue: opening the set picks up where she left off. */
export function offersContinue(set: RunFields): boolean {
  return setRun(set) === "midway";
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
