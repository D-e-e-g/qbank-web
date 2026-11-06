import { describe, expect, it } from "vitest";
import type { CourseDetail, CourseExam, CourseFolder, ExamSummary, PageBadge, SetSummary } from "../api";
import {
  BADGE_CHOICES,
  PAGE_BADGES,
  badgeLabel,
  chipState,
  courseLine,
  courseName,
  examDrawLine,
  examSetupPath,
  examTwinsLine,
  kindWords,
  nextPageName,
  pageBadge,
  pageMeta,
  pageRowMeta,
  pageSittings,
  pickedSummary,
  readExamPreset,
} from "./pages";

function set(questionCount: number, answeredCount = 0): SetSummary {
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
    fullyRightCount: answeredCount,
    lastAnsweredAt: null,
    questionIds: [],
    importedByAgent: null,
    sitting: null,
  };
}

function folder(id: string, name: string, sets: SetSummary[], examPageId: string | null = null): CourseFolder {
  return { id, name, sets, examPageId, sortOrder: 0, examBankCount: 0, examSets: [] };
}

function page(id: string, name: string): CourseExam {
  return { id, name, sortOrder: 0, weekLabels: [], folderIds: [], linkUrl: null, badge: null };
}

const exam1 = page("p1", "Exam 1");
const exam2 = page("p2", "Exam 2");
const detail = {
  kind: "course",
  folders: [
    folder("w1", "Week 1", [set(14, 14), set(13, 2)], "p1"),
    folder("w2", "Week 2", [set(12)], "p1"),
    folder("fp", "First Pass", [set(13), set(13)]),
    folder("un", "Unsorted", []),
  ],
  exams: [exam1, exam2],
} as unknown as CourseDetail;

describe("a page's lines", () => {
  it("counts its folders, sets, and questions", () => {
    expect(pageRowMeta(detail, exam1)).toBe("2 folders · 39 questions");
    expect(pageMeta(detail, exam1)).toBe("2 folders · 3 practice sets · 39 questions");
    expect(pageRowMeta(detail, exam2)).toBe("No folders yet");
    expect(pageMeta(detail, exam2)).toBe("No folders yet");
  });
});

describe("the exam twins line", () => {
  it("names the folders that have twins, and is absent when none do", () => {
    const week4 = { ...folder("w4", "Week 4", [], "p1"), examBankCount: 12 };
    const week5 = { ...folder("w5", "Week 5", [], "p1"), examBankCount: 14 };
    const week6 = { ...folder("w6", "Week 6", [set(27)], "p1"), examBankCount: 15 };
    expect(examTwinsLine([week5])).toBe("Exam twins: 14 in Week 5. Exams draw from these first.");
    expect(examTwinsLine([week4, folder("plain", "Week 3", [], "p1"), week5, week6])).toBe(
      "Exam twins: 41 in Week 4, Week 5 and Week 6. Exams draw from these first.",
    );
    expect(examTwinsLine([folder("plain", "Week 3", [], "p1")])).toBe("");
  });
});

describe("the exam draw line", () => {
  const drawn = (questionCount: number, source: "exam" | "practice" = "practice") => ({
    id: "folder",
    name: "Week 1",
    questionCount,
    drawn: questionCount,
    source,
  });

  it("says the one question as one, and All N questions for more", () => {
    expect(examDrawLine({ questionCount: 1, folders: [drawn(1)] })).toBe("The 1 question in this folder, or wrong questions only.");
    expect(examDrawLine({ questionCount: 3, folders: [drawn(3)] })).toBe("All 3 questions in this folder, or wrong questions only.");
    expect(examDrawLine({ questionCount: 9, folders: [drawn(3), drawn(3), drawn(3)] })).toBe("All 9 questions in these 3 folders, or wrong questions only.");
    expect(examDrawLine({ questionCount: 26, folders: [drawn(26, "exam")] })).toBe("All 26 questions in its exam banks, or wrong questions only.");
  });

  it("keeps the shorter draw when the exam takes fewer than the folders hold", () => {
    expect(examDrawLine({ questionCount: 40, folders: [drawn(100), drawn(117)] })).toBe("40 questions from the 217 in these 2 folders, or wrong questions only.");
  });
});

describe("pageSittings", () => {
  it("keeps the exams the server says belong to the page", () => {
    const sittings = [{ id: "a", courseExamId: "p1" }, { id: "b", courseExamId: null }, { id: "c", courseExamId: "p2" }] as ExamSummary[];
    expect(pageSittings(sittings, "p1").map((sitting) => sitting.id)).toEqual(["a"]);
  });
});

describe("nextPageName", () => {
  it("names a new page Page 1, Page 2, in a course and a topic alike", () => {
    expect(nextPageName([])).toBe("Page 1");
    expect(nextPageName([{ name: "Systems design" }])).toBe("Page 2");
  });

  it("counts on from the pages she has, her Exam 1 and Exam 2 included, skipping a name in use", () => {
    expect(nextPageName([{ name: "Exam 1" }, { name: "Exam 2" }])).toBe("Page 3");
    expect(nextPageName([{ name: "Intro" }, { name: "page 3" }])).toBe("Page 4");
  });
});

describe("a page's badge", () => {
  it("is Exam, Concept or Study, in that order", () => {
    expect(PAGE_BADGES.map(badgeLabel)).toEqual(["Exam", "Concept", "Study"]);
  });

  it("is chosen in the editor from Exam, Concept, Study and None", () => {
    expect(BADGE_CHOICES).toEqual([
      { value: "exam", label: "Exam" },
      { value: "concept", label: "Concept" },
      { value: "study", label: "Study" },
      { value: "none", label: "None" },
    ]);
  });

  it("reads the badge the server sends", () => {
    expect(pageBadge({ ...exam1, badge: "exam" })).toBe("exam");
    expect(pageBadge({ ...exam1, badge: "concept" })).toBe("concept");
    expect(pageBadge({ ...exam1, badge: "study" })).toBe("study");
    expect(pageBadge({ ...exam1, badge: null })).toBeNull();
  });

  it("is none from a server from before badges, or for one it does not know", () => {
    expect(pageBadge({ ...exam1, badge: undefined } as unknown as CourseExam)).toBeNull();
    expect(pageBadge({ ...exam1, badge: "midterm" as PageBadge })).toBeNull();
  });
});

describe("a course's and a topic's words", () => {
  it("names the course or topic and the way back to Home", () => {
    expect(kindWords("course")).toEqual({ container: "course", Container: "Course", home: "Courses" });
    expect(kindWords("topic")).toEqual({ container: "topic", Container: "Topic", home: "Topics" });
  });

  it("names a course by its code and a topic by its name", () => {
    const course = { kind: "course", code: "NURS 420", title: "Health assessment" } as const;
    const topic = { kind: "topic", code: "", title: "SWE Hire" } as const;
    expect(courseName(course)).toBe("NURS 420");
    expect(courseLine(course)).toBe("NURS 420 · Health assessment");
    expect(courseName(topic)).toBe("SWE Hire");
    expect(courseLine(topic)).toBe("SWE Hire");
  });
});

describe("Start exam's address", () => {
  it("carries the page's name and its folders to Exam setup", () => {
    const path = examSetupPath("course", "Exam 2", ["f1", "f2"]);
    expect(path).toBe("/course/course/exam?exam=Exam+2&folder=f1&folder=f2");
    expect(readExamPreset(path.slice(path.indexOf("?")))).toEqual({ name: "Exam 2", folderIds: ["f1", "f2"] });
  });

  it("is no preset without a name or a folder", () => {
    expect(readExamPreset("")).toBeNull();
    expect(readExamPreset("?exam=Exam+2")).toBeNull();
    expect(readExamPreset("?folder=f1")).toBeNull();
  });
});

describe("the page editor's chips", () => {
  it("greys a folder another page holds and names that page", () => {
    expect(chipState(detail, "p2", [], "w1")).toEqual({ kind: "taken", pageName: "Exam 1" });
    expect(chipState(detail, null, [], "w1")).toEqual({ kind: "taken", pageName: "Exam 1" });
    expect(chipState(detail, "p1", [], "w1")).toEqual({ kind: "off" });
    expect(chipState(detail, "p1", ["w1"], "w1")).toEqual({ kind: "on" });
    expect(chipState(detail, "p2", ["fp"], "fp")).toEqual({ kind: "on" });
    expect(chipState(detail, "p2", [], "fp")).toEqual({ kind: "off" });
  });

  it("calls a page it no longer has another page", () => {
    const stray = { ...detail, folders: [folder("w9", "Week 9", [], "gone")] };
    expect(chipState(stray, null, [], "w9")).toEqual({ kind: "taken", pageName: "another page" });
    expect(chipState({ ...stray, kind: "topic" }, null, [], "w9")).toEqual({ kind: "taken", pageName: "another page" });
  });

  it("sums what is ticked", () => {
    expect(pickedSummary(detail, [])).toBe("No folders yet");
    expect(pickedSummary(detail, ["fp"])).toBe("1 folder · 26 questions");
    expect(pickedSummary(detail, ["fp", "w2", "un"])).toBe("3 folders · 38 questions");
  });
});
