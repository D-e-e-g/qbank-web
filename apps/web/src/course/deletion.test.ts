import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type CourseDeletion, type ExamDeletion, type ExamPageDeletion, type FolderDeletion, type SetDeletion } from "../api";
import {
  currentUndoOffer,
  deleteConfirmed,
  deletionSummary,
  dismissUndo,
  doomedOf,
  forgetUndo,
  isDeletionChanged,
  offerUndo,
  previewDeletion,
  recentlyDeletedCourses,
  refusalText,
  takeUndo,
  warningParts,
  type DeletionPreview,
} from "./deletion";

const SET = "0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e";
const FOLDER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const EXAM = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const PAGE = "3e4f5a6b-7c8d-4e9f-8a0b-2c3d4e5f6a7b";
const COURSE = "8d3c56f1-5f43-4c62-9d0e-7a3b1f2e4c55";

const unchanged = { before: 0, after: 0 };
const progress = { answeredCount: unchanged, fullyRightCount: unchanged, reviewCount: unchanged, points: unchanged, maxPoints: unchanged, wrongCount: unchanged };

/** The server's structured warning. Left out, the preview is what an older server sent: `message` alone. */
interface SentWarning {
  title: string;
  body: string;
}

function set(title: string, message: string, warning?: SentWarning): DeletionPreview {
  const preview = {
    setId: SET,
    title,
    kind: "practice" as const,
    folderId: FOLDER,
    folderName: "Week 4",
    examPageId: null,
    questionCount: 3,
    versionCount: 1,
    answeredCount: 0,
    reviewCount: 0,
    progress,
    message,
    refusal: null,
    confirm: "set-token",
    undoDays: 30,
    ...(warning === undefined ? {} : { warning }),
  } as SetDeletion;
  return { kind: "set", preview };
}

function folder(name: string, setCount: number, message: string, warning?: SentWarning): DeletionPreview {
  const preview = {
    folderId: FOLDER,
    name,
    examPageId: null,
    examPageName: null,
    sets: [],
    setCount,
    questionCount: 5,
    answeredCount: 0,
    reviewCount: 0,
    pastExamCount: 0,
    progress,
    message,
    refusal: null,
    confirm: "folder-token",
    undoDays: 30,
    ...(warning === undefined ? {} : { warning }),
  } as FolderDeletion;
  return { kind: "folder", preview };
}

function exam(message: string, warning?: SentWarning): DeletionPreview {
  const preview = {
    examId: EXAM,
    courseId: COURSE,
    startedAt: "2026-10-12T14:00:00Z",
    finishedAt: "2026-10-12T15:00:00Z",
    questionCount: 21,
    answeredCount: 0,
    changedCount: 0,
    unansweredCount: 0,
    progress,
    message,
    refusal: null,
    confirm: "exam-token",
    undoDays: 30,
    ...(warning === undefined ? {} : { warning }),
  } as ExamDeletion;
  return { kind: "exam", preview };
}

/** An exam page with Week 3 and Week 4 on it: the page alone goes, and its folders stay. */
function examPage(name: string, message: string, warning?: SentWarning): DeletionPreview {
  const preview = {
    examPageId: PAGE,
    courseId: COURSE,
    name,
    folders: [
      { id: FOLDER, name: "Week 3", setCount: 2, questionCount: 5 },
      { id: SET, name: "Week 4", setCount: 1, questionCount: 3 },
    ],
    folderCount: 2,
    setCount: 3,
    questionCount: 8,
    examQuestionCount: 0,
    answeredCount: 1,
    pastExamCount: 1,
    progress,
    message,
    refusal: null,
    confirm: "page-token",
    undoDays: 30,
    ...(warning === undefined ? {} : { warning }),
  } as ExamPageDeletion;
  return { kind: "examPage", preview };
}

function course(kind: "course" | "topic", message: string, warning?: SentWarning): DeletionPreview {
  const preview = {
    courseId: COURSE,
    kind,
    code: kind === "topic" ? "" : "NURS 220",
    title: kind === "topic" ? "Spanish? Sí" : "Pharmacology",
    semester: kind === "topic" ? null : { id: SET, number: 1, name: "Semester 1" },
    folderCount: 4,
    examPageCount: 1,
    setCount: 9,
    questionCount: 146,
    examQuestionCount: 20,
    answeredCount: 30,
    reviewCount: 5,
    pastExamCount: 2,
    message,
    refusal: null,
    confirm: "course-token",
    undoDays: 30,
    ...(warning === undefined ? {} : { warning }),
  } as CourseDeletion;
  return { kind: "course", preview };
}

/** Stands in for the API: each request gets the next answer, and is recorded. */
function fakeApi(...answers: { status: number; body?: unknown }[]) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      // Home's course cards are read again after every change; they are not what is tested here.
      if (url === "/api/semesters") return Promise.resolve(new Response(JSON.stringify({ semesters: [] }), { status: 200 }));
      const answer = answers.shift() ?? { status: 204 };
      return Promise.resolve(new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status }));
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("warningParts", () => {
  // These previews omit `warning`: that is the older server, and message is split.
  it("splits message when warning is absent, and keeps the rest word for word", () => {
    const warning = folder("Week 4", 2, "Delete Week 4? Its 2 sets go with it: Anxiety A and Anxiety B, 5 questions in all. You can undo this for 30 days.");
    expect(warningParts(warning)).toEqual({
      title: "Delete Week 4?",
      message: "Its 2 sets go with it: Anxiety A and Anxiety B, 5 questions in all. You can undo this for 30 days.",
    });
  });

  it("finds the question after a name that holds a question mark itself", () => {
    const warning = set("Why? Because", "Delete Why? Because? Its 3 questions go with it. You can undo this for 30 days.");
    expect(warningParts(warning)).toEqual({ title: "Delete Why? Because?", message: "Its 3 questions go with it. You can undo this for 30 days." });
  });

  it("asks once about a course by its code and question count, and says it can come back", () => {
    expect(warningParts(course("course", "Delete NURS 220 and its 146 questions? You can bring it back for 30 days."))).toEqual({
      title: "Delete NURS 220 and its 146 questions?",
      message: "You can bring it back for 30 days.",
    });
    expect(warningParts(course("topic", "Delete Spanish? Sí and its 146 questions? You can bring it back for 30 days."))).toEqual({
      title: "Delete Spanish? Sí and its 146 questions?",
      message: "You can bring it back for 30 days.",
    });
  });

  it("titles a past exam's warning by its question", () => {
    expect(warningParts(exam("Delete this exam? You answered none of its questions, so your progress stays as it is.")).title).toBe("Delete this exam?");
  });

  it("asks about an exam page by its name, and says its folders stay and it can come back", () => {
    const warning = examPage(
      "Exam 2",
      "Delete Exam 2? Its 2 folders stay, with their sets and your progress, under Folders: Week 3 and Week 4. Your 1 past exam over it stays. You can undo this for 30 days.",
    );
    expect(warningParts(warning)).toEqual({
      title: "Delete Exam 2?",
      message: "Its 2 folders stay, with their sets and your progress, under Folders: Week 3 and Week 4. Your 1 past exam over it stays. You can undo this for 30 days.",
    });
  });

  it("reads warning.title and warning.body, and does not split message or use the set or course name", () => {
    expect(
      warningParts(
        set("Why? Because", "Delete Why? Because? Its 3 questions go with it. You can undo this for 30 days.", {
          title: "Delete Why? Because?",
          body: "The server wrote this, not a split of the sentence.",
        }),
      ),
    ).toEqual({ title: "Delete Why? Because?", message: "The server wrote this, not a split of the sentence." });
    expect(
      warningParts(folder("Week 4", 2, "Delete Week 4? Its 2 sets go with it.", { title: "Delete Week 4?", body: "Both sets go." })),
    ).toEqual({ title: "Delete Week 4?", message: "Both sets go." });
    expect(
      warningParts(exam("Delete this exam? Your progress stays as it is.", { title: "Delete this exam?", body: "Nothing else changes." })),
    ).toEqual({ title: "Delete this exam?", message: "Nothing else changes." });
    expect(
      warningParts(examPage("Exam 2", "Delete Exam 2? Its folders stay.", { title: "Delete Exam 2?", body: "Its folders stay in the course." })),
    ).toEqual({ title: "Delete Exam 2?", message: "Its folders stay in the course." });
    expect(
      warningParts(
        course("course", "Delete NURS 220 and its 146 questions? You can bring it back for 30 days.", {
          title: "Delete NURS 220 and its 146 questions?",
          body: "You can bring the course back for 30 days.",
        }),
      ),
    ).toEqual({ title: "Delete NURS 220 and its 146 questions?", message: "You can bring the course back for 30 days." });
    expect(
      warningParts(course("topic", "Delete Spanish? Sí and its 146 questions? You can bring it back for 30 days.", { title: "Delete this topic?", body: "It can come back." })),
    ).toEqual({ title: "Delete this topic?", message: "It can come back." });
  });
});

describe("deletionSummary", () => {
  it("names what went, and what came back", () => {
    expect(deletionSummary([set("Anxiety A", "")], "Deleted")).toBe("Deleted “Anxiety A”.");
    expect(deletionSummary([folder("Week 4", 3, "")], "Deleted")).toBe("Deleted Week 4 and its 3 sets.");
    expect(deletionSummary([folder("Week 4", 1, "")], "Brought back")).toBe("Brought back Week 4 and its set.");
    expect(deletionSummary([folder("Week 4", 0, "")], "Deleted")).toBe("Deleted Week 4.");
    expect(deletionSummary([exam("")], "Brought back")).toBe("Brought back the exam.");
    expect(deletionSummary([set("Anxiety A", ""), set("Anxiety B", "")], "Deleted")).toBe("Deleted 2 sets.");
    expect(deletionSummary([course("course", "")], "Deleted")).toBe("Deleted NURS 220.");
    expect(deletionSummary([course("topic", "")], "Brought back")).toBe("Brought back Spanish? Sí.");
    // Its folders stayed in the course, so only the page is named.
    expect(deletionSummary([examPage("Exam 2", "")], "Deleted")).toBe("Deleted Exam 2.");
    expect(deletionSummary([examPage("Exam 2", "")], "Brought back")).toBe("Brought back Exam 2.");
  });
});

describe("deleting", () => {
  it("sends the preview's confirm with the delete", async () => {
    const calls = fakeApi({ status: 204 });
    await deleteConfirmed(doomedOf(folder("Week 4", 2, "")), "folder token/1");
    expect(calls).toEqual([{ url: `/api/folders/${FOLDER}?confirm=folder+token%2F1`, method: "DELETE" }]);
  });

  it("previews and deletes a course or topic at the course's own address", async () => {
    const calls = fakeApi({ status: 200, body: course("course", "").preview }, { status: 204 });
    const preview = await previewDeletion({ kind: "course", id: COURSE });
    expect(preview.kind).toBe("course");
    await deleteConfirmed(doomedOf(preview), "course-token");
    expect(calls).toEqual([
      { url: `/api/courses/${COURSE}/delete-preview`, method: "GET" },
      { url: `/api/courses/${COURSE}?confirm=course-token`, method: "DELETE" },
    ]);
  });

  it("previews and deletes an exam page at the page's own address, with the preview's confirm", async () => {
    const calls = fakeApi({ status: 200, body: examPage("Exam 2", "").preview }, { status: 204 });
    const preview = await previewDeletion({ kind: "examPage", id: PAGE });
    expect(preview.kind).toBe("examPage");
    expect(doomedOf(preview)).toEqual({ kind: "examPage", id: PAGE });
    await deleteConfirmed(doomedOf(preview), preview.preview.confirm);
    expect(calls).toEqual([
      { url: `/api/course-exams/${PAGE}/delete-preview`, method: "GET" },
      { url: `/api/course-exams/${PAGE}?confirm=page-token`, method: "DELETE" },
    ]);
  });

  it("reads Home's Recently deleted", async () => {
    const calls = fakeApi({ status: 200, body: { undoDays: 30, courses: [] } });
    expect(await recentlyDeletedCourses()).toEqual({ undoDays: 30, courses: [] });
    expect(calls).toEqual([{ url: "/api/deleted-courses", method: "GET" }]);
  });

  it("tells a changed deletion from another refusal", async () => {
    fakeApi(
      { status: 409, body: { error: "deletion_changed", message: "Week 4 changed since you were warned. Look again before deleting it." } },
      { status: 409, body: { error: "in_use", message: "An exam in progress asks questions from Week 4. Finish or leave that exam first." } },
    );
    const changed = await deleteConfirmed({ kind: "folder", id: FOLDER }, "old").catch((caught: unknown) => caught);
    expect(changed).toBeInstanceOf(ApiError);
    expect(isDeletionChanged(changed)).toBe(true);
    expect((changed as ApiError).message).toBe("Week 4 changed since you were warned. Look again before deleting it.");
    const inUse = await deleteConfirmed({ kind: "folder", id: FOLDER }, "token").catch((caught: unknown) => caught);
    expect(isDeletionChanged(inUse)).toBe(false);
  });

  it("gives an exam page's refusals in the server's words: changed since, or a folder name in the Folders list", async () => {
    fakeApi(
      { status: 409, body: { error: "deletion_changed", message: "Exam 2 changed since you were warned. Look again before deleting it." } },
      { status: 409, body: { error: "request_refused", message: "NURS 310 already has a folder named Week 3 in its Folders list. Rename one of them before deleting Exam 2." } },
    );
    const changed = await deleteConfirmed({ kind: "examPage", id: PAGE }, "old").catch((caught: unknown) => caught);
    expect(isDeletionChanged(changed)).toBe(true);
    expect(refusalText(changed, "Could not delete it.")).toBe("Exam 2 changed since you were warned. Look again before deleting it.");
    const clash = await deleteConfirmed({ kind: "examPage", id: PAGE }, "page-token").catch((caught: unknown) => caught);
    expect(isDeletionChanged(clash)).toBe(false);
    expect(refusalText(clash, "Could not delete it.")).toBe("NURS 310 already has a folder named Week 3 in its Folders list. Rename one of them before deleting Exam 2.");
  });
});

describe("the Undo offer", () => {
  it("brings each item back, in order, and says so", async () => {
    const calls = fakeApi({ status: 200, body: {} }, { status: 200, body: {} });
    offerUndo(COURSE, [set("Anxiety A", ""), set("Anxiety B", "")]);
    const offer = currentUndoOffer();
    expect(offer?.text).toBe("Deleted 2 sets.");
    if (offer === null) throw new Error("no offer");
    await takeUndo(offer.id);
    expect(calls.filter((call) => call.method === "POST").map((call) => call.url)).toEqual([`/api/practice-sets/${SET}/undo-delete`, `/api/practice-sets/${SET}/undo-delete`]);
    expect(currentUndoOffer()?.outcome).toEqual({ state: "done", text: "Brought back 2 sets." });
    dismissUndo(offer.id);
    expect(currentUndoOffer()).toBeNull();
  });

  it("brings a deleted course back, or says why not when its code is taken now", async () => {
    const calls = fakeApi(
      { status: 409, body: { error: "request_refused", message: "Semester 1 already has a course with the code NURS 220. Rename one of them, then bring this one back." } },
      { status: 200, body: {} },
    );
    offerUndo(COURSE, [course("course", "")]);
    const refused = currentUndoOffer();
    if (refused === null) throw new Error("no offer");
    expect(refused.text).toBe("Deleted NURS 220.");
    await takeUndo(refused.id);
    expect(currentUndoOffer()?.outcome).toEqual({
      state: "failed",
      text: "Semester 1 already has a course with the code NURS 220. Rename one of them, then bring this one back.",
    });
    offerUndo(COURSE, [course("course", "")]);
    const offer = currentUndoOffer();
    if (offer === null) throw new Error("no offer");
    await takeUndo(offer.id);
    expect(currentUndoOffer()?.outcome).toEqual({ state: "done", text: "Brought back NURS 220." });
    expect(calls.filter((call) => call.method === "POST").map((call) => call.url)).toEqual([`/api/courses/${COURSE}/undo-delete`, `/api/courses/${COURSE}/undo-delete`]);
    dismissUndo(offer.id);
  });

  it("brings a deleted exam page back, or says why not: another page has its name, or its 30 days are over", async () => {
    const calls = fakeApi(
      { status: 409, body: { error: "request_refused", message: "This course already has a page named Exam 2. Rename one of them, then bring this one back." } },
      { status: 409, body: { error: "undo_expired", message: "Exam 2 was deleted more than 30 days ago, so it can't be brought back." } },
      { status: 200, body: {} },
    );
    for (const refusal of [
      "This course already has a page named Exam 2. Rename one of them, then bring this one back.",
      "Exam 2 was deleted more than 30 days ago, so it can't be brought back.",
    ]) {
      offerUndo(COURSE, [examPage("Exam 2", "")]);
      const refused = currentUndoOffer();
      if (refused === null) throw new Error("no offer");
      expect(refused.text).toBe("Deleted Exam 2.");
      await takeUndo(refused.id);
      expect(currentUndoOffer()?.outcome).toEqual({ state: "failed", text: refusal });
    }
    offerUndo(COURSE, [examPage("Exam 2", "")]);
    const offer = currentUndoOffer();
    if (offer === null) throw new Error("no offer");
    await takeUndo(offer.id);
    expect(currentUndoOffer()?.outcome).toEqual({ state: "done", text: "Brought back Exam 2." });
    expect(calls.filter((call) => call.method === "POST").map((call) => call.url)).toEqual(Array.from({ length: 3 }, () => `/api/course-exams/${PAGE}/undo-delete`));
    dismissUndo(offer.id);
  });

  it("is forgotten on sign-out, so the next account is never offered it", () => {
    fakeApi();
    offerUndo(COURSE, [course("course", "")]);
    expect(currentUndoOffer()?.text).toBe("Deleted NURS 220.");
    forgetUndo();
    expect(currentUndoOffer()).toBeNull();
  });

  it("shows the server's sentence when Undo is refused", async () => {
    fakeApi({ status: 409, body: { error: "undo_expired", message: "Week 4 was deleted more than 30 days ago, so it can't be brought back." } });
    offerUndo(COURSE, [folder("Week 4", 2, "")]);
    const offer = currentUndoOffer();
    if (offer === null) throw new Error("no offer");
    await takeUndo(offer.id);
    expect(currentUndoOffer()?.outcome).toEqual({ state: "failed", text: "Week 4 was deleted more than 30 days ago, so it can't be brought back." });
    dismissUndo(offer.id);
  });
});
