import { ApiError, api, type ExamPool, type ExamSummary, type ExamView } from "../api";

/**
 * Whether an exam of the user's is running, as this screen knows it. Not read yet, and a read that
 * failed, are "not known": never "none", so Start waits instead of ending a running exam unasked.
 */
export type RunningExam = { known: false } | { known: true; exam: ExamSummary | null };

export const NOT_KNOWN: RunningExam = { known: false };

/** What starts an exam: the folders and the pool, from Exam setup or a twin job's `exam`. */
export interface ExamChoice {
  folderIds: string[];
  pool: ExamPool;
}

/**
 * POST /api/courses/{id}/exams with `replaces`: the running exam the user confirmed ending, or null
 * when the screen knows of none. The server starts nothing and answers 409 `exam_in_progress` with
 * the running exam when that is not the one running.
 */
export type StartOutcome = { kind: "started"; exam: ExamView } | { kind: "running"; exam: ExamSummary | null; message: string };

export async function startExam(courseId: string, choice: ExamChoice, replaces: string | null): Promise<StartOutcome> {
  try {
    const exam = await api<ExamView>(`/api/courses/${courseId}/exams`, { method: "POST", json: { folderIds: choice.folderIds, pool: choice.pool, replaces } });
    return { kind: "started", exam };
  } catch (caught) {
    const running = runningRefusal(caught);
    if (running === null) throw caught;
    return running;
  }
}

/** The server's refusal to start over a running exam, with that exam when it sent one. */
function runningRefusal(caught: unknown): Extract<StartOutcome, { kind: "running" }> | null {
  if (!(caught instanceof ApiError) || caught.status !== 409) return null;
  const body = caught.body;
  if (typeof body !== "object" || body === null || !("error" in body) || body.error !== "exam_in_progress") return null;
  const inProgress = "inProgress" in body ? body.inProgress : null;
  return { kind: "running", exam: isSummary(inProgress) ? inProgress : null, message: caught.message };
}

function isSummary(value: unknown): value is ExamSummary {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" && "courseId" in value && typeof value.courseId === "string";
}

/** What tapping Start does: wait while it is not known whether an exam is running, ask when one is, or start. */
export function startTap(running: RunningExam): { kind: "wait" } | { kind: "ask"; exam: ExamSummary } | { kind: "start" } {
  if (!running.known) return { kind: "wait" };
  return running.exam === null ? { kind: "start" } : { kind: "ask", exam: running.exam };
}
