import type { ExamSummary } from "../api";

/** Where an exam stands: `running`, `grace` (its time has run out, answers sent before the end still land), or `ended`. */
export type ExamStatus = ExamSummary["status"];

/** How long after its end the server still takes an answer sent before it, as the API describes `grace`. */
export const EXAM_ANSWER_GRACE_MS = 30_000;

/** An exam as the API sends it. `status` is absent from an API from before it, which sent only `finishedAt`. */
export type ExamTimes = Omit<ExamSummary, "status"> & { status?: ExamStatus };

/**
 * The exam's status at `now`, this device's clock: the server's `status` as it was read, moved on
 * as the exam's time runs out on a screen left open, so an exam whose time is up is never read as
 * running. Without `status`, an exam with no `finishedAt` was running when read. The server stays
 * the judge: a device clock that is off only changes whether Start asks first, and the server asks
 * again (409 `exam_in_progress`) when an exam is still open there.
 */
export function examStatus(exam: ExamTimes, now: number): ExamStatus {
  const read = exam.status ?? (exam.finishedAt === null ? "running" : "ended");
  if (read === "ended") return "ended";
  const end = Date.parse(exam.endsAt);
  if (now > end + EXAM_ANSWER_GRACE_MS) return "ended";
  return now >= end ? "grace" : read;
}

/** The exam when it is open at `now` (running, or in its grace, which the server also asks about before ending it); otherwise null. */
export function openExam(exam: ExamSummary | null, now: number): ExamSummary | null {
  return exam !== null && examStatus(exam, now) !== "ended" ? exam : null;
}

/** Whole minutes left at `now`, counted up while it runs: 0 once its time has run out, never 1. */
export function minutesLeft(exam: ExamTimes, now: number): number {
  if (examStatus(exam, now) !== "running") return 0;
  return Math.ceil((Date.parse(exam.endsAt) - now) / 60_000);
}

/** When what `examStatus` and `minutesLeft` say next changes after `now`, or null once the exam has ended. */
export function nextStatusChange(exam: ExamTimes, now: number): number | null {
  const status = examStatus(exam, now);
  const end = Date.parse(exam.endsAt);
  if (status === "ended") return null;
  if (status === "grace") return end + EXAM_ANSWER_GRACE_MS + 1;
  // The minutes shown drop each time the time left reaches a whole minute; the last drop is the end.
  return end - (minutesLeft(exam, now) - 1) * 60_000;
}
