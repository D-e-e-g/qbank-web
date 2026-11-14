import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ExamSummary } from "../api";
import { NOT_KNOWN, startExam, startTap } from "./start";
import { EXAM_ANSWER_GRACE_MS } from "./status";

const COURSE = "8d3c56f1-5f43-4c62-9d0e-7a3b1f2e4c55";
const FOLDER = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";

const running: ExamSummary = {
  id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
  courseId: COURSE,
  weeks: ["Week 1"],
  folderIds: [FOLDER],
  courseExamId: null,
  pool: "all",
  practiceWeeks: null,
  questionCount: 5,
  timeLimitSeconds: 450,
  startedAt: "2026-11-11T10:00:00.000Z",
  endsAt: "2026-11-11T10:07:30.000Z",
  status: "running",
  finishedAt: null,
  endReason: null,
  answeredCount: 2,
  fullyRight: null,
  points: null,
  maxPoints: null,
  minutesUsed: null,
};

/** Answers the next request with `status` and `body`, and keeps what was sent. */
function answer(status: number, body: unknown): { sent: () => unknown } {
  let sent: unknown;
  vi.stubGlobal(
    "fetch",
    vi.fn((_path: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
  return { sent: () => sent };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A moment while `running` runs. */
const DURING = Date.parse("2026-11-11T10:05:00.000Z");
const END = Date.parse(running.endsAt);

describe("startTap", () => {
  it("waits while it is not known whether an exam is running", () => {
    expect(startTap(NOT_KNOWN, DURING)).toEqual({ kind: "wait" });
  });

  it("asks before ending a running exam, and starts when none runs", () => {
    expect(startTap({ known: true, exam: running }, DURING)).toEqual({ kind: "ask", exam: running });
    expect(startTap({ known: true, exam: null }, DURING)).toEqual({ kind: "start" });
  });

  it("asks about an exam in its grace, as the server does", () => {
    expect(startTap({ known: true, exam: running }, END + 1_000)).toEqual({ kind: "ask", exam: running });
    expect(startTap({ known: true, exam: { ...running, status: "grace" } }, END + 1_000)).toEqual({ kind: "ask", exam: { ...running, status: "grace" } });
  });

  it("starts without asking once the time of the exam read as running is up, on a screen left open", () => {
    expect(startTap({ known: true, exam: running }, END + EXAM_ANSWER_GRACE_MS + 1)).toEqual({ kind: "start" });
  });
});

describe("startExam", () => {
  it("always sends replaces: null when the screen knows of no running exam", async () => {
    const request = answer(201, { id: "e1", courseId: COURSE });
    const outcome = await startExam(COURSE, { folderIds: [FOLDER], pool: "wrong" }, null);
    expect(request.sent()).toEqual({ folderIds: [FOLDER], pool: "wrong", replaces: null });
    expect(outcome).toEqual({ kind: "started", exam: { id: "e1", courseId: COURSE } });
  });

  it("sends the id of the running exam the user confirmed ending", async () => {
    const request = answer(201, { id: "e2", courseId: COURSE });
    await startExam(COURSE, { folderIds: [FOLDER], pool: "all" }, running.id);
    expect(request.sent()).toEqual({ folderIds: [FOLDER], pool: "all", replaces: running.id });
  });

  it("reads the server's 409 as the running exam to ask about, not as an error", async () => {
    answer(409, { error: "exam_in_progress", message: "An exam is in progress.", inProgress: running });
    expect(await startExam(COURSE, { folderIds: [FOLDER], pool: "all" }, null)).toEqual({ kind: "running", exam: running, message: "An exam is in progress." });
  });

  it("reads a 409 without a running exam as none running now", async () => {
    answer(409, { error: "exam_in_progress", message: "That exam has ended.", inProgress: null });
    expect(await startExam(COURSE, { folderIds: [FOLDER], pool: "all" }, running.id)).toEqual({ kind: "running", exam: null, message: "That exam has ended." });
  });

  it("passes every other refusal on", async () => {
    answer(400, { error: "no_wrong_questions", message: "Week 1 has no wrong questions." });
    await expect(startExam(COURSE, { folderIds: [FOLDER], pool: "wrong" }, null)).rejects.toBeInstanceOf(ApiError);
    answer(409, { error: "attempt_conflict", message: "Something else." });
    await expect(startExam(COURSE, { folderIds: [FOLDER], pool: "all" }, null)).rejects.toThrow("Something else.");
  });
});
