import { describe, expect, it } from "vitest";
import type { CourseDetail, CourseExam, CourseFolder, CourseKind, SetSummary } from "../api";
import {
  folderGroups,
  folderLabel,
  folderMeta,
  folderProgress,
  looseFolders,
  pageFolders,
  reordered,
  stateLabel,
  withOrder,
} from "./folders";

function set(questionCount: number, answeredCount: number, fullyRightCount = answeredCount): SetSummary {
  return {
    id: crypto.randomUUID(),
    title: "Invented set",
    description: "",
    questionCount,
    importedAt: "2026-10-01T00:00:00Z",
    activeSince: "2026-10-01T00:00:00Z",
    status: "imported",
    canRestore: false,
    answeredCount,
    fullyRightCount,
    lastAnsweredAt: null,
    questionIds: [],
    importedByAgent: null,
    sitting: null,
  };
}

function folder(name: string, sets: SetSummary[], options: { examPageId?: string | null; sortOrder?: number; examBankCount?: number } = {}): CourseFolder {
  return { id: `id-${name}-${options.examPageId ?? "loose"}`, name, sets, examPageId: options.examPageId ?? null, sortOrder: options.sortOrder ?? 0, examBankCount: options.examBankCount ?? 0, examSets: [] };
}

function page(id: string, name: string): CourseExam {
  return { id, name, sortOrder: 0, weekLabels: [], folderIds: [], linkUrl: null, badge: null };
}

/** Only the fields the folder helpers read. */
function course(folders: CourseFolder[], exams: CourseExam[] = [], kind: CourseKind = "course"): CourseDetail {
  return { kind, folders, exams } as unknown as CourseDetail;
}

describe("folderProgress", () => {
  it("adds up the sets and names the state", () => {
    expect(folderProgress(folder("Week 1", [set(14, 0), set(12, 0)]))).toEqual({
      state: "fresh",
      setCount: 2,
      questionCount: 26,
      answeredCount: 0,
      fullyRightCount: 0,
    });
    expect(folderProgress(folder("Week 3", [set(15, 15, 12), set(12, 7, 5)])).state).toBe("started");
    expect(folderProgress(folder("Week 1", [set(14, 14, 12), set(13, 13, 10)])).state).toBe("done");
  });

  it("does not count past a set's size", () => {
    expect(folderProgress(folder("Week 1", [set(3, 5, 4)]))).toMatchObject({ state: "done", answeredCount: 3, fullyRightCount: 3 });
  });
});

describe("a folder's row", () => {
  it("shows questions, answered, or fully right with the state word", () => {
    const fresh = folder("Week 4", [set(14, 0), set(12, 0)]);
    expect(folderMeta(fresh)).toBe("2 sets · 26 questions");
    expect(stateLabel(folderProgress(fresh))).toBe("Not started");

    const started = folder("Week 3", [set(15, 15, 12), set(12, 7, 5)]);
    expect(folderMeta(started)).toBe("2 sets · 22 of 27 answered");
    expect(stateLabel(folderProgress(started))).toBe("22 of 27");

    const done = folder("Week 1", [set(14, 14, 12)]);
    expect(folderMeta(done)).toBe("1 set · 12 of 14 fully right");
    expect(stateLabel(folderProgress(done))).toBe("Done");
  });

  it("names a folder with only an exam bank, and an empty one", () => {
    const bankOnly = folder("Week 8", [], { examBankCount: 1 });
    expect(folderMeta(bankOnly)).toBe("Exam twins only · 1 question");
    expect(stateLabel(folderProgress(bankOnly))).toBe("");
    expect(folderMeta(folder("Unsorted", []))).toBe("Empty folder");
  });
});

describe("her lists", () => {
  const exam2 = page("p2", "Exam 2");
  // As the server sends them: each exam page's folders, then the Folders list, each in her order.
  const folders = [
    folder("First Pass", [], { examPageId: "p2", sortOrder: 0 }),
    folder("Second Pass", [], { examPageId: "p2", sortOrder: 1 }),
    folder("Week 1", [], { sortOrder: 0 }),
    folder("ABG Practice", [], { sortOrder: 1 }),
    folder("Week 2", [], { sortOrder: 2 }),
  ];
  const detail = course(folders, [exam2]);

  it("keeps each list in her order", () => {
    expect(looseFolders(detail).map((item) => item.name)).toEqual(["Week 1", "ABG Practice", "Week 2"]);
    expect(pageFolders(detail, "p2").map((item) => item.name)).toEqual(["First Pass", "Second Pass"]);
  });

  it("groups them by page, then the ones on no page", () => {
    expect(folderGroups(detail).map((group) => [group.title, group.folders.map((item) => item.name)])).toEqual([
      ["Exam 2", ["First Pass", "Second Pass"]],
      ["On no page", ["Week 1", "ABG Practice", "Week 2"]],
    ]);
  });

  it("puts the exam page Import was opened from first, and the rest in her order", () => {
    const exam1 = page("p1", "Exam 1");
    const two = course([...folders, folder("Week 9", [], { examPageId: "p1" })], [exam1, exam2]);
    expect(folderGroups(two).map((group) => group.title)).toEqual(["Exam 1", "Exam 2", "On no page"]);
    expect(folderGroups(two, "p2").map((group) => group.title)).toEqual(["Exam 2", "Exam 1", "On no page"]);
    expect(folderGroups(two, "gone").map((group) => group.title)).toEqual(["Exam 1", "Exam 2", "On no page"]);
  });

  it("words a topic's pages as a course's", () => {
    const topic = course(folders, [page("p2", "Page 1")], "topic");
    expect(folderGroups(topic).map((group) => group.title)).toEqual(["Page 1", "On no page"]);
  });

  it("moves one folder and keeps the rest in order", () => {
    expect(reordered(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(reordered(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(reordered(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("shows a new order before the server answers, leaving the other lists alone", () => {
    const loose = looseFolders(detail).map((item) => item.id);
    const next = withOrder(detail, reordered(loose, 2, 0));
    expect(next.folders.map((item) => [item.name, item.sortOrder])).toEqual([
      ["First Pass", 0],
      ["Second Pass", 1],
      ["Week 2", 0],
      ["Week 1", 1],
      ["ABG Practice", 2],
    ]);
    expect(looseFolders(next).map((item) => item.name)).toEqual(["Week 2", "Week 1", "ABG Practice"]);
    expect(pageFolders(next, "p2").map((item) => item.name)).toEqual(["First Pass", "Second Pass"]);
  });
});

describe("folderLabel", () => {
  it("adds the exam page only when another folder shares the name", () => {
    const onExam2 = folder("First Pass", [], { examPageId: "p2" });
    const onExam3 = folder("first pass", [], { examPageId: "p3" });
    const loose = folder("Week 1", []);
    const detail = course([onExam2, onExam3, loose], [page("p2", "Exam 2"), page("p3", "Exam 3")]);
    expect(folderLabel(detail, onExam2.id, "First Pass")).toBe("First Pass · Exam 2");
    expect(folderLabel(detail, onExam3.id, "first pass")).toBe("first pass · Exam 3");
    expect(folderLabel(detail, loose.id, "Week 1")).toBe("Week 1");
    expect(folderLabel(detail, "gone", "Week 9")).toBe("Week 9");
  });

  it("says No page for a loose folder, in a course and a topic alike", () => {
    const onPage = folder("Unsorted", [], { examPageId: "p1" });
    const loose = folder("unsorted", []);
    expect(folderLabel(course([onPage, loose], [page("p1", "Exam 1")]), loose.id, "unsorted")).toBe("unsorted · No page");
    expect(folderLabel(course([onPage, loose], [page("p1", "Page 1")], "topic"), loose.id, "unsorted")).toBe("unsorted · No page");
  });
});
