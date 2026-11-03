import { useSyncExternalStore } from "react";

export function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function navigate(to: string): void {
  const next = normalizePath(to);
  if (window.location.pathname !== next) {
    window.history.pushState(null, "", next);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
  document.querySelector("main")?.scrollTo(0, 0);
}

/** Replaces the current address, so Back skips the screen that handed off (a set just started). */
export function redirect(to: string): void {
  window.history.replaceState(null, "", normalizePath(to));
  window.dispatchEvent(new PopStateEvent("popstate"));
  document.querySelector("main")?.scrollTo(0, 0);
}

export function usePathname(): string {
  return useSyncExternalStore(subscribePath, pathnameSnapshot, serverPath);
}

function subscribePath(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
  };
}

function pathnameSnapshot(): string {
  return normalizePath(window.location.pathname);
}

function serverPath(): string {
  return "/";
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const COURSE_PATH = new RegExp(`^\\/course\\/(${UUID})(\\/terms|\\/review|\\/exam|\\/deleted)?$`, "i");
const PAGE_PATH = new RegExp(`^\\/course\\/(${UUID})\\/(exam-page|folder|twins)\\/(${UUID})$`, "i");
const EXAM_PATH = new RegExp(`^\\/course\\/(${UUID})\\/exam\\/(${UUID})$`, "i");
const PRACTICE_PATH = new RegExp(`^\\/course\\/(${UUID})\\/practice\\/(${UUID})$`, "i");
const REVIEW_PRACTICE_PATH = new RegExp(`^\\/course\\/(${UUID})\\/review\\/practice$`, "i");

export type DetailMatch =
  | { courseId: string; label: "Course" | "Terms" | "Review" | "Exam"; width: "reading"; kind: "course" | "terms" | "review" | "exam" }
  | { courseId: string; label: "Recently deleted"; width: "reading"; kind: "deleted" }
  | { courseId: string; label: "Page"; width: "reading"; kind: "exam-page"; examPageId: string }
  | { courseId: string; label: "Folder"; width: "reading"; kind: "folder"; folderId: string }
  | { courseId: string; label: "Exam twins"; width: "reading"; kind: "twins"; jobId: string };

/** The address of a course's exam page, or of one of its folders. */
export function examPagePath(courseId: string, examPageId: string): string {
  return `/course/${courseId}/exam-page/${examPageId}`;
}

export function folderPath(courseId: string, folderId: string): string {
  return `/course/${courseId}/folder/${folderId}`;
}

/** Where Import is opened from inside a course: the course picked, and one of its folders picked or an exam page's folders listed first. */
export interface ImportPreset {
  courseId: string;
  folderId: string | null;
  examPageId: string | null;
}

/** Make questions, on the Import section. `keep` starts over with the material from this session. */
export function makePath(place: { courseId?: string; keep?: boolean } = {}): string {
  const query = new URLSearchParams();
  if (place.courseId !== undefined) query.set("course", place.courseId);
  query.set(place.keep ? "keep" : "new", "1");
  return `/import/make?${query.toString()}`;
}

/** A set being made. */
export function makeJobPath(jobId: string): string {
  return `/import/make/${jobId}`;
}

export interface MakeMatch {
  jobId: string | null;
}

const MAKE_JOB_PATH = new RegExp(`^\\/import\\/make\\/(${UUID})$`, "i");

/** Your material, or one set being made. Anything else under Import is not this screen. */
export function matchMake(pathname: string): MakeMatch | null {
  const path = normalizePath(pathname);
  const job = MAKE_JOB_PATH.exec(path);
  if (job?.[1] !== undefined) return { jobId: job[1] };
  if (path.toLowerCase() === "/import/make") return { jobId: null };
  return null;
}

/** The course Make questions was opened from, and whether this visit keeps the material already entered. */
export function readMakeQuery(search: string): { courseId: string | null; keep: boolean } {
  const query = new URLSearchParams(search);
  const courseId = query.get("course")?.trim() ?? "";
  return { courseId: courseId === "" ? null : courseId, keep: query.get("keep") === "1" };
}

/** Import with the course picked, from its +, an exam page's +, or a folder's Import here. */
export function importPath(courseId: string, place: { folderId?: string; examPageId?: string } = {}): string {
  const query = new URLSearchParams({ course: courseId });
  if (place.folderId !== undefined) query.set("folder", place.folderId);
  if (place.examPageId !== undefined) query.set("page", place.examPageId);
  return `/import?${query.toString()}`;
}

export function readImportPreset(search: string): ImportPreset | null {
  const query = new URLSearchParams(search);
  const value = (key: string) => {
    const found = query.get(key)?.trim() ?? "";
    return found === "" ? null : found;
  };
  const courseId = value("course");
  return courseId === null ? null : { courseId, folderId: value("folder"), examPageId: value("page") };
}

/** A course's Recently deleted: what Undo can still bring back. */
export function deletedPath(courseId: string): string {
  return `/course/${courseId}/deleted`;
}

/** Home's Recently deleted: the courses and study topics Undo can still bring back. */
export const DELETED_COURSES_PATH = "/deleted";

export interface ExamMatch {
  courseId: string;
  examId: string;
}

/** A running exam, or an ended one's result. */
export function matchExam(pathname: string): ExamMatch | null {
  const match = EXAM_PATH.exec(normalizePath(pathname));
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { courseId: match[1], examId: match[2] };
}

/** What the runner practices: one set, or the course's Review list (filtered, or one question from it). */
export type PracticeMatch = { courseId: string; kind: "set"; setId: string } | { courseId: string; kind: "review" };

/** A set or the Review list open in the practice runner. */
export function matchPractice(pathname: string): PracticeMatch | null {
  const path = normalizePath(pathname);
  const set = PRACTICE_PATH.exec(path);
  if (set?.[1] !== undefined && set[2] !== undefined) return { courseId: set[1], kind: "set", setId: set[2] };
  const review = REVIEW_PRACTICE_PATH.exec(path);
  if (review?.[1] !== undefined) return { courseId: review[1], kind: "review" };
  return null;
}

/** Course, exam page, folder, terms, Review, exam setup, Recently deleted, and twin job addresses. Anything else, including /course/42, is not a screen. */
export function matchDetail(pathname: string): DetailMatch | null {
  const path = normalizePath(pathname);
  const page = PAGE_PATH.exec(path);
  if (page?.[1] !== undefined && page[3] !== undefined) {
    const courseId = page[1];
    const kind = page[2]?.toLowerCase();
    if (kind === "folder") return { courseId, label: "Folder", width: "reading", kind: "folder", folderId: page[3] };
    if (kind === "twins") return { courseId, label: "Exam twins", width: "reading", kind: "twins", jobId: page[3] };
    return { courseId, label: "Page", width: "reading", kind: "exam-page", examPageId: page[3] };
  }
  const match = COURSE_PATH.exec(path);
  const courseId = match?.[1];
  if (courseId === undefined) return null;
  if (match?.[2] === "/terms") return { courseId, label: "Terms", width: "reading", kind: "terms" };
  if (match?.[2] === "/review") return { courseId, label: "Review", width: "reading", kind: "review" };
  if (match?.[2] === "/exam") return { courseId, label: "Exam", width: "reading", kind: "exam" };
  if (match?.[2] === "/deleted") return { courseId, label: "Recently deleted", width: "reading", kind: "deleted" };
  return { courseId, label: "Course", width: "reading", kind: "course" };
}

export function useSearch(): string {
  return useSyncExternalStore(subscribePath, searchSnapshot, () => "");
}

function searchSnapshot(): string {
  return window.location.search;
}
