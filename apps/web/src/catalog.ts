import { useSyncExternalStore } from "react";
import { ApiError, api, type CatalogRecord, type CourseKind, type SemesterRecord } from "./api";

export interface CourseLink {
  id: string;
  /** "topic" for a study topic: a course with no semester, called by its title. */
  kind: CourseKind;
  code: string;
  title: string;
  sortOrder: number;
  archivedAt: string | null;
  questionCount: number;
  folderCount: number;
  reviewCount: number;
  answeredCount: number;
  fullyRightCount: number;
  points: number;
  maxPoints: number;
}

export interface SemesterGroup {
  id: string;
  number: number;
  label: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  /** Set when she archived the semester by hand; Home shows it in Archived. */
  archivedAt: string | null;
  courses: readonly CourseLink[];
}

/**
 * The user's semesters, courses and study topics, as far as this device knows them. Loading until
 * the server answers, and again after sign-out. Failed when the first read failed, with the sentence
 * to show: nothing is known, which is not the same as an account with no courses. Ready once a read
 * succeeded; a later read that fails leaves it ready, with the courses it had.
 */
export type Catalog =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      semesters: readonly SemesterGroup[];
      /** The study topics in the user's order, archived ones included. */
      topics: readonly CourseLink[];
    };

export type ReadyCatalog = Extract<Catalog, { status: "ready" }>;

/** The semesters and topics of a catalog that is ready. */
type Courses = Pick<ReadyCatalog, "semesters" | "topics">;

const listeners = new Set<() => void>();

let snapshot: Catalog = { status: "loading" };

function publish(next: Catalog): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The catalog as it is now. */
export function currentCatalog(): Catalog {
  return snapshot;
}

export function useCatalog(): Catalog {
  return useSyncExternalStore(subscribe, currentCatalog, currentCatalog);
}

/** Her course or topic with this id, from Home's list, so a screen can name it before it loads. */
export function useCatalogCourse(courseId: string): CourseLink | undefined {
  return findCourse(useCatalog(), courseId);
}

/** The course or topic with this id, archived ones included; none until the catalog is ready. */
export function findCourse(catalog: Catalog, courseId: string): CourseLink | undefined {
  if (catalog.status !== "ready") return undefined;
  return [...catalog.semesters.flatMap((semester) => semester.courses), ...catalog.topics].find((course) => course.id === courseId);
}

export interface HomeLayout {
  /** Her semesters in use, each with its courses in use. */
  semesters: { semester: SemesterGroup; courses: CourseLink[] }[];
  /** Her topics in use, in her order. */
  topics: CourseLink[];
  /** What she archived by hand, under its semester or Study topics: a semester with every course, or the courses and topics alone. */
  archived: { key: string; title: string; courses: CourseLink[] }[];
}

/** Home's groups, which the sidebar and Import's menu share: what she studies now, then what she archived. */
export function homeLayout(catalog: Courses): HomeLayout {
  const inUse = (course: CourseLink) => course.archivedAt === null;
  const archived: HomeLayout["archived"] = [];
  for (const semester of catalog.semesters) {
    const courses = semester.archivedAt === null ? semester.courses.filter((course) => !inUse(course)) : [...semester.courses];
    if (semester.archivedAt !== null || courses.length > 0) archived.push({ key: semester.id, title: semester.label, courses });
  }
  const archivedTopics = catalog.topics.filter((topic) => !inUse(topic));
  if (archivedTopics.length > 0) archived.push({ key: "topics", title: "Study topics", courses: archivedTopics });
  return {
    semesters: catalog.semesters
      .filter((semester) => semester.archivedAt === null)
      .map((semester) => ({ semester, courses: semester.courses.filter(inUse) })),
    topics: catalog.topics.filter(inUse),
    archived,
  };
}

/** The courses and topics in use, which the course menus of Import and Make questions list. None until the catalog is ready. */
export function courseMenu(catalog: Catalog): { courses: CourseLink[]; topics: CourseLink[] } {
  if (catalog.status !== "ready") return { courses: [], topics: [] };
  const layout = homeLayout(catalog);
  return { courses: layout.semesters.flatMap(({ courses }) => courses), topics: layout.topics };
}

/**
 * Whether an id is a course or topic the user has in use: not known until the catalog is ready, so
 * a screen neither waits forever nor treats the course as a new one in the meantime.
 */
export type CourseStanding = "unknown-yet" | "theirs" | "not-theirs";

/** One answer for "is this id one of the user's courses", for Import and Make questions alike. */
export function courseStanding(catalog: Catalog, id: string | null): CourseStanding {
  if (catalog.status !== "ready") return "unknown-yet";
  const { courses, topics } = courseMenu(catalog);
  return [...courses, ...topics].some((course) => course.id === id) ? "theirs" : "not-theirs";
}

// Goes up on sign-out, so an answer asked for by the last account is dropped when it arrives.
let signOuts = 0;

/**
 * Reads the catalog from the server. After a failed load it is loading again while this asks, which
 * is what Try again does. A read that fails once the catalog is ready keeps the courses on screen.
 */
export async function refreshCatalog(): Promise<void> {
  const askedFor = signOuts;
  if (snapshot.status === "failed") publish({ status: "loading" });
  try {
    const record = await api<CatalogRecord>("/api/semesters");
    if (askedFor === signOuts) publish(fromRecord(record));
  } catch (caught) {
    if (askedFor !== signOuts || snapshot.status === "ready") return;
    publish({ status: "failed", message: caught instanceof ApiError ? caught.message : "Could not load your courses." });
  }
}

/**
 * A failed load is tried again by itself when the device comes back online, the signal a saved
 * answer retries on (submit-attempt.ts). Returns what stops listening.
 */
export function retryCatalogWhenOnline(): () => void {
  const retry = () => {
    if (snapshot.status === "failed") void refreshCatalog();
  };
  window.addEventListener("online", retry);
  return () => {
    window.removeEventListener("online", retry);
  };
}

/** Forgets the courses and topics on sign-out, so the next account on this device never sees them. */
export function forgetCatalog(): void {
  signOuts += 1;
  publish({ status: "loading" });
}

/** What the server answered. A new account has no semester, so none is shown. */
export function fromRecord(record: CatalogRecord): ReadyCatalog {
  return { status: "ready", semesters: record.semesters.map(toGroup), topics: record.topics };
}

function toGroup(semester: SemesterRecord): SemesterGroup {
  return {
    id: semester.id,
    number: semester.number,
    label: semester.name,
    name: semester.name,
    startsOn: semester.startsOn,
    endsOn: semester.endsOn,
    archivedAt: semester.archivedAt,
    courses: [...semester.courses].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)),
  };
}
