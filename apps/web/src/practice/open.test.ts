import { afterEach, describe, expect, it, vi } from "vitest";
import { openPractice, type Opening } from "./open";
import type { PracticeSource } from "./source";

const COURSE = "8d3c56f1-5f43-4c62-9d0e-7a3b1f2e4c55";
const SET = "3e4f5a6b-7c8d-4e9f-8a0b-2c3d4e5f6a7b";
const SET_PATH = `/api/practice-sets/${SET}`;
const COURSE_PATH = `/api/courses/${COURSE}`;

const setSource: PracticeSource = { kind: "set", key: SET, loadPath: SET_PATH, closeTo: `/course/${COURSE}`, closeLabel: "Back to course" };
const reviewSource: PracticeSource = {
  kind: "review",
  key: "review",
  loadPath: `/api/courses/${COURSE}/review/practice`,
  closeTo: `/course/${COURSE}/review`,
  closeLabel: "Back to Review",
};

const question = {
  id: "5b1f3d4e-8c2a-4f1b-9e3d-2a1b3c4d5e6f",
  publicId: "Q1",
  position: 0,
  type: "single",
  topic: "Heart failure",
  cj: null,
  stem: "A client is short of breath.",
  ask: "Which action comes first?",
  rationale: "Sitting up eases breathing.",
  takeaway: "Position first.",
  body: { options: [{ t: "Sit the client up", ok: true }, { t: "Offer water" }] },
  table: null,
  images: [],
  terms: [],
};

/** The set as GET /api/practice-sets/{id} sends it, with `run` left out when it is undefined. */
function practiceSet(run?: string) {
  return { id: SET, courseId: COURSE, title: "Week 1", weekLabel: "Week 1", questions: [question], sitting: null, ...(run === undefined ? {} : { run }) };
}

/** The course with the set's row on it, as a server that does not send `run` describes a finished set. */
const finishedCourse = { folders: [{ sets: [{ id: SET, sitting: null, questionCount: 1, answeredCount: 1 }] }] };

/** Answers each path with its body, or a 500 when it has none, and keeps the paths asked for. */
function fakeApi(bodies: Record<string, unknown>) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      asked.push(url);
      const body = bodies[url];
      return Promise.resolve(body === undefined ? new Response(JSON.stringify({ error: "server_error" }), { status: 500 }) : new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
  return asked;
}

function newRun(opening: Opening): boolean | string {
  return "session" in opening ? opening.session.newRun : opening.error;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opening a practice set", () => {
  it("asks only for the set when it says where she stands", async () => {
    for (const run of ["new", "midway", "restarted", "done"]) {
      const asked = fakeApi({ [SET_PATH]: practiceSet(run), [COURSE_PATH]: finishedCourse });
      expect(newRun(await openPractice(COURSE, setSource))).toBe(run === "done");
      expect(asked).toEqual([SET_PATH]);
    }
  });

  it("opens a done set as a new run when the course cannot be read", async () => {
    fakeApi({ [SET_PATH]: practiceSet("done") });
    expect(newRun(await openPractice(COURSE, setSource))).toBe(true);
  });

  it("reads the course row for a set from a server that does not send run", async () => {
    const asked = fakeApi({ [SET_PATH]: practiceSet(), [COURSE_PATH]: finishedCourse });
    expect(newRun(await openPractice(COURSE, setSource))).toBe(true);
    expect(asked).toEqual([SET_PATH, COURSE_PATH]);
  });

  it("treats a run it does not know as no run", async () => {
    const asked = fakeApi({ [SET_PATH]: practiceSet("finished"), [COURSE_PATH]: finishedCourse });
    expect(newRun(await openPractice(COURSE, setSource))).toBe(true);
    expect(asked).toEqual([SET_PATH, COURSE_PATH]);
  });

  it("leaves a set without a run not finished when the course cannot be read, as before", async () => {
    fakeApi({ [SET_PATH]: practiceSet() });
    expect(newRun(await openPractice(COURSE, setSource))).toBe(false);
  });

  it("never reads the course for Review", async () => {
    const asked = fakeApi({ [reviewSource.loadPath]: practiceSet(), [COURSE_PATH]: finishedCourse });
    expect(newRun(await openPractice(COURSE, reviewSource))).toBe(false);
    expect(asked).toEqual([reviewSource.loadPath]);
  });

  it("says why it cannot open the set", async () => {
    fakeApi({ [SET_PATH]: { kind: "exam" } });
    expect(await openPractice(COURSE, setSource)).toEqual({ error: "This set’s questions are asked only on exams." });
    fakeApi({ [SET_PATH]: { ...practiceSet("new"), courseId: "other" } });
    expect(await openPractice(COURSE, setSource)).toEqual({ error: "That set is not in this course." });
    fakeApi({ [SET_PATH]: { id: SET } });
    expect(await openPractice(COURSE, setSource)).toEqual({ error: "This set could not be read." });
    fakeApi({});
    expect(await openPractice(COURSE, setSource)).toEqual({ error: "server_error" });
  });
});
