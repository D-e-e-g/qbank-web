import { describe, expect, it } from "vitest";
import type { ExamSummary } from "../api";
import { EXAM_ANSWER_GRACE_MS, examStatus, minutesLeft, nextStatusChange, openExam, type ExamTimes } from "./status";

const END = Date.parse("2026-11-11T10:07:30.000Z");

const running: ExamSummary = {
  id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
  courseId: "8d3c56f1-5f43-4c62-9d0e-7a3b1f2e4c55",
  weeks: ["Week 1"],
  folderIds: null,
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

/** As an API from before `status` sends it. */
function withoutStatus(exam: ExamSummary): ExamTimes {
  const old: ExamTimes = { ...exam };
  delete old.status;
  return old;
}

describe("examStatus", () => {
  it("reads the server's status while the clock agrees with it", () => {
    expect(examStatus(running, END - 60_000)).toBe("running");
    expect(examStatus({ ...running, status: "grace" }, END + 1_000)).toBe("grace");
    expect(examStatus({ ...running, status: "ended", finishedAt: running.endsAt, endReason: "timeout" }, END - 60_000)).toBe("ended");
  });

  it("moves a running exam on as its time runs out on a screen left open", () => {
    expect(examStatus(running, END - 1)).toBe("running");
    expect(examStatus(running, END)).toBe("grace");
    expect(examStatus(running, END + EXAM_ANSWER_GRACE_MS)).toBe("grace");
    expect(examStatus(running, END + EXAM_ANSWER_GRACE_MS + 1)).toBe("ended");
  });

  it("keeps the server's grace when this device's clock is behind", () => {
    expect(examStatus({ ...running, status: "grace" }, END - 5_000)).toBe("grace");
  });

  it("falls back to finishedAt when the API sends no status", () => {
    expect(examStatus(withoutStatus(running), END - 60_000)).toBe("running");
    expect(examStatus(withoutStatus(running), END + 1)).toBe("grace");
    expect(examStatus(withoutStatus(running), END + EXAM_ANSWER_GRACE_MS + 1)).toBe("ended");
    expect(examStatus({ ...withoutStatus(running), finishedAt: "2026-11-11T10:05:00.000Z", endReason: "finished" }, END - 60_000)).toBe("ended");
  });
});

describe("openExam", () => {
  it("is the exam while it is running or in its grace, and none once its time is up", () => {
    expect(openExam(null, END)).toBeNull();
    expect(openExam(running, END - 1)).toBe(running);
    expect(openExam(running, END + 1)).toBe(running);
    expect(openExam(running, END + EXAM_ANSWER_GRACE_MS + 1)).toBeNull();
    expect(openExam({ ...running, status: "ended", finishedAt: running.endsAt, endReason: "timeout" }, END - 60_000)).toBeNull();
  });
});

describe("minutesLeft", () => {
  it("counts whole minutes up while running", () => {
    expect(minutesLeft(running, END - 450_000)).toBe(8);
    expect(minutesLeft(running, END - 60_000)).toBe(1);
    expect(minutesLeft(running, END - 1)).toBe(1);
  });

  it("is 0, never 1, once time has run out", () => {
    expect(minutesLeft(running, END)).toBe(0);
    expect(minutesLeft(running, END + 10_000)).toBe(0);
    expect(minutesLeft({ ...running, status: "grace" }, END - 5_000)).toBe(0);
    expect(minutesLeft(running, END + EXAM_ANSWER_GRACE_MS + 1)).toBe(0);
  });
});

describe("nextStatusChange", () => {
  it("is when the minutes shown next drop, then the end, then the end of the grace", () => {
    expect(nextStatusChange(running, END - 150_000)).toBe(END - 120_000);
    expect(nextStatusChange(running, END - 120_000)).toBe(END - 60_000);
    expect(nextStatusChange(running, END - 30_000)).toBe(END);
    expect(nextStatusChange(running, END)).toBe(END + EXAM_ANSWER_GRACE_MS + 1);
    expect(nextStatusChange({ ...running, status: "grace" }, END - 5_000)).toBe(END + EXAM_ANSWER_GRACE_MS + 1);
  });

  it("is never, once the exam has ended", () => {
    expect(nextStatusChange(running, END + EXAM_ANSWER_GRACE_MS + 1)).toBeNull();
    expect(nextStatusChange({ ...running, status: "ended", finishedAt: running.endsAt, endReason: "timeout" }, END)).toBeNull();
  });
});
