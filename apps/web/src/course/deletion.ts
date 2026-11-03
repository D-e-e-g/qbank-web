import { useSyncExternalStore } from "react";
import { refreshCatalog } from "../catalog";
import {
  ApiError,
  api,
  type CourseDeletion,
  type ExamDeletion,
  type ExamPageDeletion,
  type FolderDeletion,
  type RecentlyDeleted,
  type RecentlyDeletedCourses,
  type SetDeletion,
} from "../api";

/**
 * Deleting takes three steps, each the server's: the preview names what goes and gives a `confirm`
 * token, the delete sends that token back so it deletes exactly what she was shown, and Undo brings
 * it back as it was for 30 days. Nothing is deleted except by her confirmed delete. A course or
 * study topic is deleted from Home the same way, with everything in it. An exam page (`examPage`)
 * goes alone: its folders stay in the course, with their sets, and "exam" is a past exam.
 */
export type Doomed =
  | { kind: "set"; id: string }
  | { kind: "folder"; id: string }
  | { kind: "examPage"; id: string }
  | { kind: "exam"; id: string }
  | { kind: "course"; id: string };

export type DeletionPreview =
  | { kind: "set"; preview: SetDeletion }
  | { kind: "folder"; preview: FolderDeletion }
  | { kind: "examPage"; preview: ExamPageDeletion }
  | { kind: "exam"; preview: ExamDeletion }
  | { kind: "course"; preview: CourseDeletion };

const BASE: Record<Doomed["kind"], string> = {
  set: "/api/practice-sets",
  folder: "/api/folders",
  examPage: "/api/course-exams",
  exam: "/api/exams",
  course: "/api/courses",
};

export async function previewDeletion(item: Doomed): Promise<DeletionPreview> {
  const path = `${BASE[item.kind]}/${item.id}/delete-preview`;
  if (item.kind === "set") return { kind: "set", preview: await api<SetDeletion>(path) };
  if (item.kind === "folder") return { kind: "folder", preview: await api<FolderDeletion>(path) };
  if (item.kind === "examPage") return { kind: "examPage", preview: await api<ExamPageDeletion>(path) };
  if (item.kind === "course") return { kind: "course", preview: await api<CourseDeletion>(path) };
  return { kind: "exam", preview: await api<ExamDeletion>(path) };
}

/** Deletes what the preview named, with its `confirm`. One that changed since is refused with 409 `deletion_changed`. */
export async function deleteConfirmed(item: Doomed, confirm: string): Promise<void> {
  await api(`${BASE[item.kind]}/${item.id}?${new URLSearchParams({ confirm }).toString()}`, { method: "DELETE" });
}

/** Brings it back as it was, within its 30 days; the server's refusal sentence says why not otherwise. */
export async function undoDeletion(item: Doomed): Promise<void> {
  await api(`${BASE[item.kind]}/${item.id}/undo-delete`, { method: "POST" });
}

export async function recentlyDeleted(courseId: string): Promise<RecentlyDeleted> {
  return api<RecentlyDeleted>(`/api/courses/${courseId}/deleted`);
}

/** Her courses and study topics deleted in the last 30 days: Home's Recently deleted. */
export async function recentlyDeletedCourses(): Promise<RecentlyDeletedCourses> {
  return api<RecentlyDeletedCourses>("/api/deleted-courses");
}

/** What she is deleting, from her own preview: the set's, folder's or exam page's name, a course's code, a topic's name, or "this exam". */
export function doomedName(deletion: DeletionPreview): string {
  if (deletion.kind === "set") return deletion.preview.title;
  if (deletion.kind === "folder" || deletion.kind === "examPage") return deletion.preview.name;
  if (deletion.kind === "course") return deletion.preview.kind === "topic" ? deletion.preview.title : deletion.preview.code;
  return "this exam";
}

/**
 * The sheet's title and the rest of the warning. The server sends them as `warning.title` and
 * `warning.body` beside `message`. A set's or course's own `title` names that set or course and
 * is not this question. When `warning` is absent, as an older server sent only `message`, the
 * question is the first "?" after the doomed name and the rest is the message, word for word.
 */
export function warningParts(deletion: DeletionPreview): { title: string; message: string } {
  const sent = deletion.preview.warning;
  if (isDeleteWarning(sent)) return { title: sent.title, message: sent.body };
  const text = deletion.preview.message.trim();
  const from = text.indexOf(doomedName(deletion));
  const end = text.indexOf("?", from === -1 ? 0 : from + doomedName(deletion).length);
  if (end === -1) return { title: "Delete?", message: text };
  return { title: text.slice(0, end + 1), message: text.slice(end + 1).trim() };
}

/** `warning` as the server sends it. Anything else, including a missing field, is the old prose. */
function isDeleteWarning(value: unknown): value is { title: string; body: string } {
  if (typeof value !== "object" || value === null || !("title" in value) || !("body" in value)) return false;
  return typeof value.title === "string" && typeof value.body === "string";
}

/**
 * What the Undo offer says: "Deleted “Anxiety disorders”.", "Deleted Week 4 and its 3 sets.",
 * "Deleted 2 sets.", "Deleted Exam 2." (its folders stayed), or "Deleted NURS 220.", and once
 * Undo worked, the same with "Brought back".
 */
export function deletionSummary(deletions: readonly DeletionPreview[], done: "Deleted" | "Brought back"): string {
  const [only] = deletions;
  if (only === undefined) return "";
  if (deletions.length > 1) return `${done} ${String(deletions.length)} sets.`;
  if (only.kind === "set") return `${done} “${only.preview.title}”.`;
  if (only.kind === "exam") return `${done} the exam.`;
  if (only.kind === "examPage" || only.kind === "course") return `${done} ${doomedName(only)}.`;
  const sets = only.preview.setCount;
  return sets === 0 ? `${done} ${only.preview.name}.` : `${done} ${only.preview.name} and its ${sets === 1 ? "set" : `${String(sets)} sets`}.`;
}

/** The server's refusal sentence, or the fallback when there was none. */
export function refusalText(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

/** The delete was refused because what goes changed since the preview: look again, then confirm again. */
export function isDeletionChanged(caught: unknown): boolean {
  return caught instanceof ApiError && caught.status === 409 && errorCode(caught.body) === "deletion_changed";
}

function errorCode(body: unknown): string | null {
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : null;
}

/**
 * The Undo offered right after a delete, one at a time: a newer delete replaces it. It belongs to
 * the shell, so it stays while the screen changes (a deleted folder's screen goes back).
 */
export interface UndoOffer {
  id: number;
  courseId: string;
  text: string;
  /** What it says once Undo brought everything back. */
  undoneText: string;
  items: readonly Doomed[];
  /** Set once Undo was tapped: what it says now ("Brought back …", or the refusal), with no button. */
  outcome: { state: "working" | "done" | "failed"; text: string } | null;
}

let offer: UndoOffer | null = null;
let nextOffer = 1;
const offerListeners = new Set<() => void>();

function publishOffer(next: UndoOffer | null): void {
  offer = next;
  for (const listener of offerListeners) listener();
}

/** Offers Undo for what was just deleted, and has every screen of the course read it again. */
export function offerUndo(courseId: string, deletions: readonly DeletionPreview[]): void {
  publishOffer({
    id: nextOffer++,
    courseId,
    text: deletionSummary(deletions, "Deleted"),
    undoneText: deletionSummary(deletions, "Brought back"),
    items: deletions.map(doomedOf),
    outcome: null,
  });
  courseChanged(courseId);
}

export function doomedOf(deletion: DeletionPreview): Doomed {
  if (deletion.kind === "set") return { kind: "set", id: deletion.preview.setId };
  if (deletion.kind === "folder") return { kind: "folder", id: deletion.preview.folderId };
  if (deletion.kind === "examPage") return { kind: "examPage", id: deletion.preview.examPageId };
  if (deletion.kind === "course") return { kind: "course", id: deletion.preview.courseId };
  return { kind: "exam", id: deletion.preview.examId };
}

export function dismissUndo(id: number): void {
  if (offer?.id === id) publishOffer(null);
}

/** Forgets the Undo on offer on sign-out, so the next account on this device is never offered it. */
export function forgetUndo(): void {
  publishOffer(null);
}

/** Undo for the offer: brings each item back, in the order they were deleted, and says how it went. */
export async function takeUndo(id: number): Promise<void> {
  const current = offer;
  if (current?.id !== id || current.outcome !== null) return;
  publishOffer({ ...current, outcome: { state: "working", text: "Bringing it back." } });
  let back = 0;
  try {
    for (const item of current.items) {
      await undoDeletion(item);
      back += 1;
    }
  } catch (caught: unknown) {
    if (back > 0) courseChanged(current.courseId);
    if (offer?.id === id) publishOffer({ ...current, outcome: { state: "failed", text: refusalText(caught, "Could not bring it back.") } });
    return;
  }
  courseChanged(current.courseId);
  if (offer?.id === id) publishOffer({ ...current, outcome: { state: "done", text: current.undoneText } });
}

function subscribeOffer(listener: () => void): () => void {
  offerListeners.add(listener);
  return () => {
    offerListeners.delete(listener);
  };
}

/** The Undo on offer now, or null. */
export function currentUndoOffer(): UndoOffer | null {
  return offer;
}

export function useUndoOffer(): UndoOffer | null {
  return useSyncExternalStore(subscribeOffer, currentUndoOffer, () => null);
}

/**
 * A course's version: it goes up when a delete or an Undo changed the course, so every screen
 * showing it (the course, its folders, exam pages, Exam setup, Recently deleted) reads it again.
 * The version of all courses goes up with each, for Home's Recently deleted.
 */
const versions = new Map<string, number>();
let everyCourse = 0;
const versionListeners = new Set<() => void>();

export function courseChanged(courseId: string): void {
  versions.set(courseId, (versions.get(courseId) ?? 0) + 1);
  everyCourse += 1;
  for (const listener of versionListeners) listener();
  // Home's course cards count questions and Review too.
  void refreshCatalog();
}

function subscribeVersion(listener: () => void): () => void {
  versionListeners.add(listener);
  return () => {
    versionListeners.delete(listener);
  };
}

export function useCourseVersion(courseId: string): number {
  return useSyncExternalStore(
    subscribeVersion,
    () => versions.get(courseId) ?? 0,
    () => 0,
  );
}

/** Goes up whenever a delete or an Undo changed any course: a course or topic deleted, or brought back. */
export function useCoursesVersion(): number {
  return useSyncExternalStore(
    subscribeVersion,
    () => everyCourse,
    () => 0,
  );
}
