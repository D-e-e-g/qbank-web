import { describe, expect, it } from "vitest";
import { importPath, makeJobPath, makePath, matchDetail, matchMake, readImportPreset, readMakeQuery } from "./router";

const COURSE = "8d3c56f1-5f43-4c62-9d0e-7a3b1f2e4c55";
const JOB = "6a1f0b8e-2c4d-4e6f-8a0b-1c2d3e4f5a6b";

describe("matchDetail", () => {
  it("opens a twin job's page under its course", () => {
    expect(matchDetail(`/course/${COURSE}/twins/${JOB}`)).toEqual({ courseId: COURSE, label: "Exam twins", width: "reading", kind: "twins", jobId: JOB });
    expect(matchDetail(`/course/${COURSE}/twins/${JOB}/`)).toMatchObject({ kind: "twins", jobId: JOB });
  });

  it("keeps exam setup, folders and exam pages as they were", () => {
    expect(matchDetail(`/course/${COURSE}/exam`)).toMatchObject({ kind: "exam", courseId: COURSE });
    expect(matchDetail(`/course/${COURSE}/folder/${JOB}`)).toMatchObject({ kind: "folder", folderId: JOB });
    expect(matchDetail(`/course/${COURSE}/exam-page/${JOB}`)).toMatchObject({ kind: "exam-page", examPageId: JOB });
  });

  it("opens a course's Recently deleted", () => {
    expect(matchDetail(`/course/${COURSE}/deleted`)).toEqual({ courseId: COURSE, label: "Recently deleted", width: "reading", kind: "deleted" });
    expect(matchDetail(`/course/${COURSE}/deleted/${JOB}`)).toBeNull();
  });

  it("is not a screen for a twin job without a job id", () => {
    expect(matchDetail(`/course/${COURSE}/twins`)).toBeNull();
    expect(matchDetail(`/course/${COURSE}/twins/42`)).toBeNull();
  });
});

describe("Make questions", () => {
  it("opens under Import, with the course picked, and one set at its own address", () => {
    expect(makePath()).toBe("/import/make?new=1");
    expect(makePath({ courseId: COURSE })).toBe(`/import/make?course=${COURSE}&new=1`);
    expect(makePath({ courseId: COURSE, keep: true })).toBe(`/import/make?course=${COURSE}&keep=1`);
    expect(matchMake("/import/make")).toEqual({ jobId: null });
    expect(matchMake("/import/make/")).toEqual({ jobId: null });
    expect(matchMake(makeJobPath(JOB))).toEqual({ jobId: JOB });
    expect(matchMake("/import")).toBeNull();
    expect(matchMake(`/import/make/${COURSE}/extra`)).toBeNull();
  });

  it("reads the course and whether her material stays", () => {
    expect(readMakeQuery("?new=1")).toEqual({ courseId: null, keep: false });
    expect(readMakeQuery(`?course=${COURSE}&keep=1`)).toEqual({ courseId: COURSE, keep: true });
    expect(readMakeQuery("?course=")).toEqual({ courseId: null, keep: false });
  });
});

describe("Import opened from inside a course", () => {
  it("picks the course, and a folder or an exam page when it came from one", () => {
    expect(importPath(COURSE)).toBe(`/import?course=${COURSE}`);
    expect(readImportPreset(importPath(COURSE).slice("/import".length))).toEqual({ courseId: COURSE, folderId: null, examPageId: null });
    expect(readImportPreset(importPath(COURSE, { folderId: JOB }).slice("/import".length))).toEqual({ courseId: COURSE, folderId: JOB, examPageId: null });
    expect(readImportPreset(importPath(COURSE, { examPageId: JOB }).slice("/import".length))).toEqual({ courseId: COURSE, folderId: null, examPageId: JOB });
  });

  it("picks nothing without a course", () => {
    expect(readImportPreset("")).toBeNull();
    expect(readImportPreset(`?folder=${JOB}`)).toBeNull();
    expect(readImportPreset("?course=")).toBeNull();
  });
});
