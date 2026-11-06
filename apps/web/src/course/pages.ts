import type { CourseDetail, CourseExam, CourseFolder, CourseKind, ExamPreview, ExamSummary, PageBadge } from "../api";
import { pageFolders, setsProgress, type FolderProgress } from "./folders";

/**
 * Every word a study topic says differently from a course, from the kind the server sends. Both
 * hold pages, and everything inside works the same, timed exam included, so only these differ.
 */
export interface KindWords {
  /** "course" or "topic", inside a sentence: "This topic has no question sets yet." */
  container: string;
  /** "Course" or "Topic": the back link to it from Review, Terms, Exam setup and an exam's result. */
  Container: string;
  /** The back link from it to Home: "Courses" or "Topics". */
  home: string;
}

const COURSE_WORDS: KindWords = { container: "course", Container: "Course", home: "Courses" };

const TOPIC_WORDS: KindWords = { container: "topic", Container: "Topic", home: "Topics" };

export function kindWords(kind: CourseKind): KindWords {
  return kind === "topic" ? TOPIC_WORDS : COURSE_WORDS;
}

/** What the screens call it: a course by its code ("NURS 420"), a topic by its name (its code is empty). */
export function courseName(course: { kind: CourseKind; code: string; title: string }): string {
  return course.kind === "topic" ? course.title : course.code;
}

/** Its code and name for a course ("NURS 420 · Health assessment"), and a topic's name alone. */
export function courseLine(course: { kind: CourseKind; code: string; title: string }): string {
  return course.kind === "topic" ? course.title : `${course.code} · ${course.title}`;
}

/** How far she is through a page's folders, added up from their practice sets. */
export function pageProgress(course: CourseDetail, page: CourseExam): FolderProgress {
  return setsProgress(pageFolders(course, page.id).flatMap((folder) => folder.sets));
}

/** A page's row on the course page: "5 folders · 217 questions", or "No folders yet". */
export function pageRowMeta(course: CourseDetail, page: CourseExam): string {
  const folders = pageFolders(course, page.id);
  if (folders.length === 0) return "No folders yet";
  return `${plural(folders.length, "folder")} · ${plural(pageProgress(course, page).questionCount, "question")}`;
}

/** The line under a page's name: "5 folders · 16 practice sets · 217 questions", or "No folders yet". */
export function pageMeta(course: CourseDetail, page: CourseExam): string {
  const folders = pageFolders(course, page.id);
  if (folders.length === 0) return "No folders yet";
  const progress = pageProgress(course, page);
  return `${plural(folders.length, "folder")} · ${plural(progress.setCount, "practice set")} · ${plural(progress.questionCount, "question")}`;
}

/**
 * The line under Start exam when a folder on the page has exam twins, or "" when none do.
 * "Exam twins: 14 in Week 5. Exams draw from these first." Several folders are named in her order:
 * "41 in Week 4, Week 5 and Week 6".
 */
export function examTwinsLine(folders: readonly CourseFolder[]): string {
  const banks = folders.filter((folder) => folder.examBankCount > 0);
  if (banks.length === 0) return "";
  const count = banks.reduce((sum, folder) => sum + folder.examBankCount, 0);
  return `Exam twins: ${String(count)} in ${joined(banks.map((folder) => folder.name))}. Exams draw from these first.`;
}

/**
 * Under Start exam, from the server's plan over the page's folders.
 * "All 26 questions in this folder, or wrong questions only."
 * One question: "The 1 question in this folder, or wrong questions only."
 * Fewer than the folders hold: "40 questions from the 217 in these 5 folders, or wrong questions only."
 */
export function examDrawLine(preview: Pick<ExamPreview, "questionCount" | "folders">): string {
  const pool = preview.folders;
  const total = pool.reduce((sum, folder) => sum + folder.questionCount, 0);
  const where = pool.every((folder) => folder.source === "exam") ? "its exam banks" : pool.length === 1 ? "this folder" : `these ${String(pool.length)} folders`;
  const draw =
    preview.questionCount < total
      ? `${String(preview.questionCount)} questions from the ${String(total)} in ${where}`
      : total === 1
        ? `The 1 question in ${where}`
        : `All ${String(total)} questions in ${where}`;
  return `${draw}, or wrong questions only.`;
}

/** Her finished exams that belong to a page: the server names the page that holds all their folders. */
export function pageSittings(sittings: readonly ExamSummary[], examPageId: string): ExamSummary[] {
  return sittings.filter((sitting) => sitting.courseExamId === examPageId);
}

/** "Page 3" for a course or a topic with two pages, skipping a name already used. */
export function nextPageName(pages: readonly { name: string }[]): string {
  const used = new Set(pages.map((page) => page.name.trim().toLowerCase()));
  let number = pages.length + 1;
  while (used.has(`page ${String(number)}`)) number += 1;
  return `Page ${String(number)}`;
}

/** A page's badge choices, in the editor's order. */
export const PAGE_BADGES: readonly PageBadge[] = ["exam", "concept", "study"];

const BADGE_WORDS: Record<PageBadge, string> = { exam: "Exam", concept: "Concept", study: "Study" };

/** "Exam", "Concept" or "Study": a badge's tag and its choice in the editor. */
export function badgeLabel(badge: PageBadge): string {
  return BADGE_WORDS[badge];
}

/** The editor's Badge choices: Exam, Concept and Study, then None for no badge. */
export const BADGE_CHOICES: readonly { value: PageBadge | "none"; label: string }[] = [
  ...PAGE_BADGES.map((badge) => ({ value: badge, label: badgeLabel(badge) })),
  { value: "none", label: "None" },
];

/** A page's badge, or null for none. A server from before badges sends none, and one it does not know reads as none. */
export function pageBadge(page: CourseExam): PageBadge | null {
  const badge = page.badge ?? null;
  return badge !== null && PAGE_BADGES.includes(badge) ? badge : null;
}

/** Where a page's Start exam goes: Exam setup with its folders ticked and its name shown. */
export function examSetupPath(courseId: string, name: string, folderIds: readonly string[]): string {
  const query = new URLSearchParams([["exam", name], ...folderIds.map((id): [string, string] => ["folder", id])]);
  return `/course/${courseId}/exam?${query.toString()}`;
}

/** The page and folders Exam setup arrives with, from the address Start exam opened. */
export interface ExamPreset {
  name: string;
  folderIds: string[];
}

export function readExamPreset(search: string): ExamPreset | null {
  const query = new URLSearchParams(search);
  const name = query.get("exam")?.trim() ?? "";
  const folderIds = query.getAll("folder").filter((id) => id.trim() !== "");
  return name === "" || folderIds.length === 0 ? null : { name, folderIds };
}

/** A folder chip in the page editor: on this page, on another one (named), or free to tap. */
export type ChipState = { kind: "on" } | { kind: "off" } | { kind: "taken"; pageName: string };

/** `editing` is the page being edited, or null for a new one; `picked` is what the editor has ticked. */
export function chipState(course: CourseDetail, editing: string | null, picked: readonly string[], folderId: string): ChipState {
  if (picked.includes(folderId)) return { kind: "on" };
  const holder = course.folders.find((item) => item.id === folderId)?.examPageId ?? null;
  if (holder === null || holder === editing) return { kind: "off" };
  const owner = course.exams.find((page) => page.id === holder);
  return { kind: "taken", pageName: owner?.name ?? "another page" };
}

/** The live line under the chips: "3 folders · 83 questions", or "No folders yet". */
export function pickedSummary(course: CourseDetail, picked: readonly string[]): string {
  if (picked.length === 0) return "No folders yet";
  const sets = course.folders.filter((folder) => picked.includes(folder.id)).flatMap((folder) => folder.sets);
  return `${plural(picked.length, "folder")} · ${plural(setsProgress(sets).questionCount, "question")}`;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${count === 1 ? noun : `${noun}s`}`;
}

/** "Week 5", "Week 4 and Week 5", or "Week 4, Week 5 and Week 6". */
function joined(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}
