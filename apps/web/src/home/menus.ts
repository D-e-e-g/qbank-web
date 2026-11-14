import type { CourseLink, SemesterGroup } from "../catalog";
import { reordered } from "../course/folders";

/**
 * What Home's + adds, in the menu's order: a course in each semester she is in (not archived), a
 * study topic, and the next semester while one of 1, 2 and 3 is missing.
 */
export type HomeAdd =
  | { kind: "course"; semester: SemesterGroup; label: string }
  | { kind: "topic"; label: string }
  | { kind: "semester"; number: number; label: string };

/** The semester numbers an account can have. */
const SEMESTER_NUMBERS = [1, 2, 3] as const;

export function homeAdds(catalog: { semesters: readonly SemesterGroup[] }): HomeAdd[] {
  const adds: HomeAdd[] = catalog.semesters
    .filter((semester) => semester.archivedAt === null)
    .map((semester) => ({ kind: "course", semester, label: `New course in ${semester.label}` }));
  adds.push({ kind: "topic", label: "New study topic" });
  // Only the lowest missing number, so the menu stays short; the next one shows once it exists.
  const missing = SEMESTER_NUMBERS.find((number) => !catalog.semesters.some((semester) => semester.number === number));
  if (missing !== undefined) adds.push({ kind: "semester", number: missing, label: `Add Semester ${String(missing)}` });
  return adds;
}

/**
 * What a course card or topic card on Home offers from its "…" or a right-click. Open and Rename
 * always; a course moves to each other semester she is in, a topic moves up or down among her
 * topics in use; Archive for one in use and Unarchive for one she archived; and Delete last, on
 * every card, since Recently deleted brings it back for 30 days.
 */
export type CardAction =
  | { kind: "open" }
  | { kind: "rename" }
  | { kind: "move"; semester: SemesterGroup }
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "archive" }
  | { kind: "unarchive" }
  | { kind: "delete" };

export function cardActions(course: CourseLink, catalog: { semesters: readonly SemesterGroup[]; topics: readonly CourseLink[] }): CardAction[] {
  const actions: CardAction[] = [{ kind: "open" }, { kind: "rename" }];
  if (course.kind === "topic") {
    const inUse = catalog.topics.filter((topic) => topic.archivedAt === null);
    const at = inUse.findIndex((topic) => topic.id === course.id);
    if (at > 0) actions.push({ kind: "up" });
    if (at !== -1 && at < inUse.length - 1) actions.push({ kind: "down" });
  } else {
    const home = semesterOf(course, catalog.semesters);
    for (const semester of catalog.semesters) {
      if (semester.archivedAt === null && semester.id !== home?.id) actions.push({ kind: "move", semester });
    }
  }
  if (course.archivedAt !== null) {
    actions.push({ kind: "unarchive" });
  } else if (course.kind === "topic" || semesterOf(course, catalog.semesters)?.archivedAt === null) {
    // A course in an archived semester is in Archived with it; moving it to another semester brings it back.
    actions.push({ kind: "archive" });
  }
  actions.push({ kind: "delete" });
  return actions;
}

export function cardActionLabel(action: CardAction): string {
  switch (action.kind) {
    case "open":
      return "Open";
    case "rename":
      return "Rename";
    case "move":
      return `Move to ${action.semester.label}`;
    case "up":
      return "Move up";
    case "down":
      return "Move down";
    case "archive":
      return "Archive";
    case "unarchive":
      return "Unarchive";
    case "delete":
      return "Delete";
  }
}

/** The semester a course is in, or undefined for a topic. */
export function semesterOf(course: CourseLink, semesters: readonly SemesterGroup[]): SemesterGroup | undefined {
  return semesters.find((semester) => semester.courses.some((item) => item.id === course.id));
}

/**
 * Her topic order after one moves a place up (-1) or down (+1) among the ones in use. It names
 * every topic, as the server asks, with the archived ones after the others.
 */
export function topicOrderAfterMove(topics: readonly CourseLink[], topicId: string, step: -1 | 1): string[] {
  const inUse = topics.filter((topic) => topic.archivedAt === null).map((topic) => topic.id);
  const at = inUse.indexOf(topicId);
  const order = at === -1 ? inUse : reordered(inUse, at, at + step);
  return [...order, ...topics.filter((topic) => topic.archivedAt !== null).map((topic) => topic.id)];
}
