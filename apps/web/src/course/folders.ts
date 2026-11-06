import type { CourseDetail, CourseExam, CourseFolder, SetSummary } from "../api";

/** How far she is through some practice sets: nothing answered, some, or every question. */
export type FolderState = "fresh" | "started" | "done";

export interface FolderProgress {
  state: FolderState;
  setCount: number;
  questionCount: number;
  answeredCount: number;
  fullyRightCount: number;
}

export function setsProgress(sets: readonly SetSummary[]): FolderProgress {
  let questionCount = 0;
  let answeredCount = 0;
  let fullyRightCount = 0;
  for (const set of sets) {
    questionCount += set.questionCount;
    answeredCount += Math.min(set.answeredCount, set.questionCount);
    fullyRightCount += Math.min(set.fullyRightCount, set.questionCount);
  }
  const state: FolderState = answeredCount === 0 ? "fresh" : answeredCount >= questionCount ? "done" : "started";
  return { state, setCount: sets.length, questionCount, answeredCount, fullyRightCount };
}

export function folderProgress(folder: CourseFolder): FolderProgress {
  return setsProgress(folder.sets);
}

/** The folder's line under its name, e.g. "2 sets · 22 of 27 answered". */
export function folderMeta(folder: CourseFolder, progress: FolderProgress = folderProgress(folder)): string {
  if (progress.setCount === 0) return folder.examBankCount > 0 ? `Exam twins only · ${questions(folder.examBankCount)}` : "Empty folder";
  const sets = `${String(progress.setCount)} ${progress.setCount === 1 ? "set" : "sets"}`;
  const { questionCount, answeredCount, fullyRightCount } = progress;
  if (progress.state === "fresh") return `${sets} · ${questions(questionCount)}`;
  if (progress.state === "done") return `${sets} · ${String(fullyRightCount)} of ${String(questionCount)} fully right`;
  return `${sets} · ${String(answeredCount)} of ${String(questionCount)} answered`;
}

/** The word at a row's right edge: Done, how far she is, or Not started. Empty when there is no practice set. */
/** Where a folder sits, as its note and More's Change page say it. */
export function folderPlace(page: CourseExam | null): string {
  return page === null ? "On no page" : `On ${page.name}`;
}

/** What a folder with no sets says. An exam bank is a set too, but not one to practice, so the folder holding only one says so. */
export function folderEmptyMessage(folder: CourseFolder, readOnly: boolean): string {
  const bankOnly = folder.examBankCount > 0;
  if (readOnly) return bankOnly ? "No practice sets in this folder." : "No sets in this folder.";
  return `${bankOnly ? "No practice sets yet." : "No sets yet."} Import a question file here, or move sets here from another folder.`;
}

export function stateLabel(progress: FolderProgress): string {
  if (progress.setCount === 0) return "";
  if (progress.state === "done") return "Done";
  if (progress.state === "fresh") return "Not started";
  return `${String(progress.answeredCount)} of ${String(progress.questionCount)}`;
}

/** The course's folders on no exam page, in her order (the server sends each list in it): the course page's Folders list. */
export function looseFolders(course: CourseDetail): CourseFolder[] {
  return course.folders.filter((folder) => folder.examPageId === null);
}

/** The folders on one exam page, in her order. */
export function pageFolders(course: CourseDetail, examPageId: string): CourseFolder[] {
  return course.folders.filter((folder) => folder.examPageId === examPageId);
}

/**
 * The course's folders as she sees them: each exam page's in turn, then the ones on no exam page.
 * `firstPageId` puts one page's folders first, for Import opened from that page.
 */
export function folderGroups(course: CourseDetail, firstPageId: string | null = null): { key: string; title: string; folders: CourseFolder[] }[] {
  const pages = [...course.exams].sort((a, b) => Number(b.id === firstPageId) - Number(a.id === firstPageId));
  const groups = pages.map((page) => ({ key: page.id, title: page.name, folders: pageFolders(course, page.id) }));
  groups.push({ key: "loose", title: "On no page", folders: looseFolders(course) });
  return groups.filter((group) => group.folders.length > 0);
}

export function examPageOf(course: CourseDetail, folder: CourseFolder): CourseExam | null {
  return course.exams.find((page) => page.id === folder.examPageId) ?? null;
}

/**
 * A folder's name where it shows outside its own list: "First Pass · Exam 3" when another folder
 * of the course has the same name, so two First Pass folders on different exam pages stay apart.
 * `name` stands in for a folder the course no longer has.
 */
export function folderLabel(course: CourseDetail, folderId: string, name: string): string {
  const folder = course.folders.find((item) => item.id === folderId);
  if (folder === undefined) return name;
  const key = folder.name.trim().toLowerCase();
  const shared = course.folders.some((item) => item.id !== folder.id && item.name.trim().toLowerCase() === key);
  if (!shared) return folder.name;
  return `${folder.name} · ${examPageOf(course, folder)?.name ?? "No page"}`;
}

/** The list a folder belongs to: an exam page's id, or null for the course's Folders list. */
export function listOf(course: CourseDetail, examPageId: string | null): CourseFolder[] {
  return examPageId === null ? looseFolders(course) : pageFolders(course, examPageId);
}

/** The ids in a new order after one moves from `from` to `to`. */
export function reordered(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

/**
 * The course with one list's folders in the given order, as the server will send it after saving:
 * they take that list's places in `folders`, in the new order, and the other lists stay put.
 */
export function withOrder(course: CourseDetail, ids: readonly string[]): CourseDetail {
  const byId = new Map(course.folders.map((folder) => [folder.id, folder]));
  const moved = new Set(ids);
  let next = 0;
  return {
    ...course,
    folders: course.folders.map((folder) => {
      if (!moved.has(folder.id)) return folder;
      const sortOrder = next;
      next += 1;
      const placed = byId.get(ids[sortOrder] ?? "") ?? folder;
      return { ...placed, sortOrder };
    }),
  };
}

function questions(count: number): string {
  return `${String(count)} ${count === 1 ? "question" : "questions"}`;
}
