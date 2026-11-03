import type { components, paths } from "./api-schema";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(messageFrom(body));
    this.status = status;
    this.body = body;
  }
}

/** The API's shapes, generated from its pinned contract (contract/openapi.json). */
type Schemas = components["schemas"];

/** "exam" for an exam set: questions asked only on exams. */
export type SetKind = Schemas["ImportReport"]["kind"];
export type ImportReport = Schemas["ImportReport"];
export type ImportConflict = Schemas["ImportConflict"];
export type ImportedSet = Schemas["ImportedSet"];
export type SemesterRecord = Schemas["Semester"];
export type SemesterCourse = SemesterRecord["courses"][number];
/** Her semesters, each with its courses, and her study topics: GET /api/semesters. */
export type CatalogRecord = paths["/api/semesters"]["get"]["responses"][200]["content"]["application/json"];
export type CourseDetail = Schemas["CourseDetail"];
/** A study topic is a course with no semester, which the screens call by its title; "course" for every course. */
export type CourseKind = CourseDetail["kind"];
export type SetSummary = Schemas["SetSummary"];
/** A folder of a course: her name for it, the exam page it is on, its place in its list, and its sets. */
export type CourseFolder = Schemas["Folder"];
/** What a page is for, which she sets in its editor: Exam, Concept or Study. A page has one or none (null). */
export type PageBadge = Schemas["PageBadge"];
/**
 * A page of a course or a topic (a course exam) and the folders on it. A folder is on one page at
 * most. Its badge is Exam, Concept or Study, or null for none.
 */
export type CourseExam = Schemas["CourseExam"];
export type ReviewQuestion = Schemas["ReviewQuestion"];
export type ReviewList = Schemas["ReviewList"];
export type RepairPlan = Schemas["RepairPlan"];
export type CourseTerm = Schemas["Term"];
export type ExamEndReason = NonNullable<ExamSummary["endReason"]>;
/** All questions in the ticked folders, or only the ones she last answered not fully right. */
export type ExamPool = ExamSummary["pool"];
export type ExamSummary = Schemas["ExamSummary"];
export type ExamSetup = Schemas["ExamSetup"];
export type ExamSetupFolder = ExamSetup["folders"][number];
/** What an exam over some folders would draw from each, and its time, worked out as starting it does. */
export type ExamPreview = Schemas["ExamPreview"];
export type ExamResult = Schemas["ExamResult"];
export type ExamBreakdownRow = ExamResult["byStep"][number];
export type ExamItemResult = ExamResult["items"][number];
/** An exam as the server sends it. Questions keep the practice-set shape plus their week. */
export type ExamView = Schemas["Exam"];
/** Whether this account may make questions now (Make questions and exam twins), and why not. */
export type QuestionMakerStatus = Schemas["QuestionMakerStatus"];
/** Exam twins of the folders and pool she picked on Exam setup, written in the background. */
export type TwinJob = Schemas["QuestionTwinJob"];
export type TwinJobStep = TwinJob["steps"][number];
export type TwinSet = Schemas["QuestionTwinSet"];
/** Once a twin job is done: the body of POST /api/courses/{id}/exams that starts the exam on the twins. */
export type TwinExam = Schemas["QuestionTwinExam"];
/** What deleting a set, a folder (with its sets) or a past exam takes with it: the warning, and the `confirm` that deletes exactly that. */
export type SetDeletion = Schemas["SetDeletion"];
export type FolderDeletion = Schemas["FolderDeletion"];
export type ExamDeletion = Schemas["ExamDeletion"];
/** What deleting an exam page changes: the page alone goes, and its folders stay, with their sets and her progress, under Folders. */
export type ExamPageDeletion = Schemas["ExamPageDeletion"];
/** What deleting a course or study topic takes with it, and the question to ask her once. */
export type CourseDeletion = Schemas["CourseDeletion"];
/** A course's exam pages, folders, sets and past exams deleted in the last 30 days: everything Undo can still bring back. */
export type RecentlyDeleted = Schemas["RecentlyDeleted"];
export type DeletedExamPage = Schemas["DeletedExamPage"];
export type DeletedFolder = Schemas["DeletedFolder"];
export type DeletedSet = Schemas["DeletedSet"];
export type DeletedExam = Schemas["DeletedExam"];
/** Her courses and study topics deleted in the last 30 days, for Undo. */
export type RecentlyDeletedCourses = Schemas["RecentlyDeletedCourses"];
export type DeletedCourse = Schemas["DeletedCourse"];

export async function api<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const request: RequestInit = { method };
  if (init.json !== undefined) {
    request.headers = { "content-type": "application/json" };
    request.body = JSON.stringify(init.json);
  }
  const response = await fetch(path, request);
  const text = await response.text();
  const body: unknown = text === "" ? null : (JSON.parse(text) as unknown);
  if (!response.ok) {
    // One place for a dead session, for every screen that calls api().
    reportSessionFailure(path, method, response.status, body);
    throw new ApiError(response.status, body);
  }
  return body as T;
}

/** What a failed request means for the signed-in app, when it means anything. */
export type SessionNotice = { kind: "signed-out" } | { kind: "must-change" };

let onSessionEnd: ((notice: SessionNotice) => void) | null = null;

/** The app registers once. A 401 or a temporary-password 403 then moves the gate, instead of each screen. */
export function bindSessionEnd(onEnd: (notice: SessionNotice) => void): () => void {
  onSessionEnd = onEnd;
  return () => {
    if (onSessionEnd === onEnd) onSessionEnd = null;
  };
}

/**
 * A 401 outside sign-in, sign-up and delete-account ends the session on this device.
 * Choosing a new password also answers 401 when the current password is wrong, and that one stays.
 * A 403 `must_change_password` from any route goes to the change-password step.
 * The login client calls this same function, so those flows are decided here too.
 */
export function reportSessionFailure(path: string, method: string, status: number, body: unknown): void {
  if (onSessionEnd === null) return;
  if (status === 403 && errorCode(body) === "must_change_password") {
    onSessionEnd({ kind: "must-change" });
    return;
  }
  if (status === 401 && sessionEnded(path, method, body)) onSessionEnd({ kind: "signed-out" });
}

export function isConflict(body: unknown): body is ImportConflict {
  return typeof body === "object" && body !== null && "conflict" in body && body.conflict === true;
}

function messageFrom(body: unknown): string {
  if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string") return body.message;
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  return "Something went wrong.";
}

function errorCode(body: unknown): string | null {
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : null;
}

/** The path without a query or hash, so a filtered read is the same route. */
function requestPath(path: string): string {
  const query = path.indexOf("?");
  const hash = path.indexOf("#");
  let end = path.length;
  if (query !== -1) end = Math.min(end, query);
  if (hash !== -1) end = Math.min(end, hash);
  return path.slice(0, end);
}

/**
 * Sign-in, sign-up and delete-account answer 401 for a wrong password as well as a dead session,
 * and each flow already says which. Delete-account's own 401 unauthenticated signs out from its sheet.
 */
function keepsItsOwn401(path: string, method: string): boolean {
  const pathname = requestPath(path);
  if (pathname === "/api/sign-in/password" || pathname === "/api/sign-up") return true;
  return pathname === "/api/me" && method.toUpperCase() === "DELETE";
}

function sessionEnded(path: string, method: string, body: unknown): boolean {
  if (keepsItsOwn401(path, method)) return false;
  // The same 401 is a wrong current password here, which keeps her on the screen.
  if (requestPath(path) === "/api/account/password" && errorCode(body) !== "unauthenticated") return false;
  return true;
}
