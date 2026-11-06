import type { DeletedCourse, RecentlyDeletedCourses } from "../api";
import { DeletedGroup, DeletedRow, UndoOutcome } from "../components/DeletedList";
import { EmptyState } from "../components/EmptyState";
import { courseChanged, recentlyDeletedCourses, useCoursesVersion } from "../course/deletion";
import { courseLine, courseName } from "../course/pages";
import { useUndoList } from "../course/useUndoList";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";
import { when } from "../when";

/**
 * Home's Recently deleted: the courses and study topics she deleted in the last 30 days, newest
 * first, each with Undo until its 30 days run out. Undo brings one back whole, with its folders,
 * exam pages, sets and past exams, in its semester or her topics as before.
 */
export function DeletedCoursesScreen() {
  const version = useCoursesVersion();
  const { list: deleted, loadError, error, done, busy, undo } = useUndoList<RecentlyDeletedCourses>(recentlyDeletedCourses, version, (item) => {
    courseChanged(item.id);
  });

  const courses = deleted?.courses.filter((course) => course.kind === "course") ?? [];
  const topics = deleted?.courses.filter((course) => course.kind === "topic") ?? [];
  const days = deleted?.undoDays ?? 30;

  const row = (course: DeletedCourse) => (
    <DeletedRow
      key={course.id}
      icon={course.kind === "topic" ? "book-marked" : "graduation-cap"}
      title={courseLine(course)}
      meta={`${courseMeta(course)} · Deleted ${when(course.deletedAt)}`}
      refusal={course.undoRefusal}
      busy={busy.has(course.id)}
      label={`Undo deleting ${courseName(course)}`}
      onUndo={() => {
        undo({ kind: "course", id: course.id }, courseName(course));
      }}
    />
  );

  return (
    <Screen title="Recently deleted">
      <ShellLink to="/" className="text-action" current={false}>
        Home
      </ShellLink>
      <p className="note">
        The courses and study topics you deleted in the last {days} days. Undo brings each back as it was, with its folders and sets, and your answers counting again.
      </p>
      <UndoOutcome loadError={loadError} error={error} done={done} />
      {deleted === null ? (
        loadError ? null : <p className="note">Loading Recently deleted.</p>
      ) : deleted.courses.length === 0 ? (
        <div className="empty-card">
          <EmptyState icon="trash-2" message={`No course or study topic was deleted in the last ${String(days)} days.`} />
        </div>
      ) : (
        <>
          {courses.length > 0 ? <DeletedGroup title="Courses">{courses.map(row)}</DeletedGroup> : null}
          {topics.length > 0 ? <DeletedGroup title="Study topics">{topics.map(row)}</DeletedGroup> : null}
          <p className="group-footer">Each one can be brought back for {days} days after it was deleted. After that it stays deleted.</p>
        </>
      )}
    </Screen>
  );
}

/** "From Semester 1 · 146 questions" for a course; a topic's question count alone. */
function courseMeta(course: DeletedCourse): string {
  const questions = `${String(course.questionCount)} ${course.questionCount === 1 ? "question" : "questions"}`;
  return course.semester === null ? questions : `From ${course.semester.name} · ${questions}`;
}
