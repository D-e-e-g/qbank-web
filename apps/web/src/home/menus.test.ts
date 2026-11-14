import { describe, expect, it } from "vitest";
import type { CourseLink, SemesterGroup } from "../catalog";
import { cardActionLabel, cardActions, homeAdds, topicOrderAfterMove } from "./menus";

function card(id: string, kind: CourseLink["kind"], archivedAt: string | null = null): CourseLink {
  return {
    id,
    kind,
    code: kind === "topic" ? "" : id.toUpperCase(),
    title: `${id} title`,
    sortOrder: 0,
    archivedAt,
    questionCount: 0,
    folderCount: 0,
    reviewCount: 0,
    answeredCount: 0,
    fullyRightCount: 0,
    points: 0,
    maxPoints: 0,
  };
}

function semester(number: number, courses: CourseLink[], options: { archivedAt?: string; label?: string } = {}): SemesterGroup {
  const label = options.label ?? `Semester ${String(number)}`;
  return {
    id: `s${String(number)}`,
    number,
    label,
    name: label,
    startsOn: null,
    endsOn: null,
    archivedAt: options.archivedAt ?? null,
    courses,
  };
}

const ARCHIVED = "2026-10-01T00:00:00Z";

describe("Home's + menu", () => {
  it("adds a course to each semester she is in, a topic, and the next missing semester", () => {
    const adds = homeAdds({ semesters: [semester(1, []), semester(2, [], { label: "Fall 2026" })] });
    expect(adds.map((add) => add.label)).toEqual(["New course in Semester 1", "New course in Fall 2026", "New study topic", "Add Semester 3"]);
    expect(adds[1]).toMatchObject({ kind: "course", semester: { id: "s2" } });
  });

  it("offers no course for an archived semester, and no semester once all three exist", () => {
    const adds = homeAdds({ semesters: [semester(1, [], { archivedAt: ARCHIVED }), semester(2, []), semester(3, [])] });
    expect(adds.map((add) => add.label)).toEqual(["New course in Semester 2", "New course in Semester 3", "New study topic"]);
  });

  it("offers the lowest missing number, so a gap is filled first", () => {
    expect(homeAdds({ semesters: [semester(1, []), semester(3, [])] }).at(-1)).toEqual({ kind: "semester", number: 2, label: "Add Semester 2" });
    expect(homeAdds({ semesters: [] }).map((add) => add.label)).toEqual(["New study topic", "Add Semester 1"]);
  });
});

describe("a card's menu", () => {
  const nurs220 = card("nurs220", "course");
  const pharm = card("pharm", "course", ARCHIVED);
  const semesters = [semester(1, [nurs220, pharm]), semester(2, []), semester(3, [], { archivedAt: ARCHIVED })];
  const labels = (course: CourseLink, topics: CourseLink[] = []) => cardActions(course, { semesters, topics }).map(cardActionLabel);

  it("opens, renames, moves to each other semester she is in, archives and deletes a course", () => {
    expect(labels(nurs220)).toEqual(["Open", "Rename", "Move to Semester 2", "Archive", "Delete"]);
  });

  it("unarchives a course she archived", () => {
    expect(labels(pharm)).toEqual(["Open", "Rename", "Move to Semester 2", "Unarchive", "Delete"]);
  });

  it("moves a course in an archived semester out of it, rather than archiving it again", () => {
    const old = card("old", "course");
    const archivedSemester = [semester(1, []), semester(2, [old], { archivedAt: ARCHIVED })];
    expect(cardActions(old, { semesters: archivedSemester, topics: [] }).map(cardActionLabel)).toEqual(["Open", "Rename", "Move to Semester 1", "Delete"]);
  });

  it("moves a topic up or down among the topics in use, never to a semester", () => {
    const [t1, t2, t3, t4] = [card("t1", "topic"), card("t2", "topic"), card("t3", "topic"), card("t4", "topic", ARCHIVED)];
    const topics = [t1, t2, t3, t4];
    expect(labels(t1, topics)).toEqual(["Open", "Rename", "Move down", "Archive", "Delete"]);
    expect(labels(t2, topics)).toEqual(["Open", "Rename", "Move up", "Move down", "Archive", "Delete"]);
    expect(labels(t3, topics)).toEqual(["Open", "Rename", "Move up", "Archive", "Delete"]);
    expect(labels(t4, topics)).toEqual(["Open", "Rename", "Unarchive", "Delete"]);
  });

  it("deletes any course or topic, last, archived ones too", () => {
    const topic = card("t1", "topic", ARCHIVED);
    for (const course of [nurs220, pharm, topic]) {
      expect(cardActions(course, { semesters, topics: [topic] }).at(-1)).toEqual({ kind: "delete" });
    }
  });
});

describe("her topic order after a move", () => {
  const topics = [card("t1", "topic"), card("t2", "topic"), card("old", "topic", ARCHIVED), card("t3", "topic")];

  it("moves one a place among the ones in use and names every topic, archived ones last", () => {
    expect(topicOrderAfterMove(topics, "t3", -1)).toEqual(["t1", "t3", "t2", "old"]);
    expect(topicOrderAfterMove(topics, "t1", 1)).toEqual(["t2", "t1", "t3", "old"]);
  });

  it("keeps the order when there is nowhere to go", () => {
    expect(topicOrderAfterMove(topics, "t1", -1)).toEqual(["t1", "t2", "t3", "old"]);
    expect(topicOrderAfterMove(topics, "old", -1)).toEqual(["t1", "t2", "t3", "old"]);
  });
});
