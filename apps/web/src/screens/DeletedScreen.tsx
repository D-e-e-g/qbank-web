import { useCallback, useEffect } from "react";
import type { DeletedExam, DeletedExamPage, DeletedFolder, DeletedSet, RecentlyDeleted } from "../api";
import { DeletedGroup, DeletedRow, UndoOutcome } from "../components/DeletedList";
import { EmptyState } from "../components/EmptyState";
import { courseChanged, recentlyDeleted, useCourseVersion } from "../course/deletion";
import { courseName } from "../course/pages";
import { useCourse, useCourseNaming } from "../course/useCourse";
import { useUndoList } from "../course/useUndoList";
import { foldersText } from "../exam/names";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";
import { when } from "../when";

/**
 * Recently deleted: the course's exam pages, folders, sets and past exams she deleted in the last
 * 30 days, newest first, each with Undo until its 30 days run out. A set that went with its folder
 * comes back with the folder, so it is listed under the folder, not on its own. An exam page went
 * alone: its folders are in the course meanwhile, and Undo puts them back on it.
 */
export function DeletedScreen({ courseId }: { courseId: string }) {
  const { course } = useCourse(courseId);
  const { name, words } = useCourseNaming(courseId, course);
  const version = useCourseVersion(courseId);
  const read = useCallback(() => recentlyDeleted(courseId), [courseId]);
  const { list: deleted, loadError, error, done, busy, undo } = useUndoList<RecentlyDeleted>(read, version, () => {
    courseChanged(courseId);
  });

  useEffect(() => {
    if (course) document.title = `Recently deleted · ${courseName(course)} · Qbank`;
  }, [course]);

  const empty = deleted !== null && deleted.examPages.length + deleted.folders.length + deleted.sets.length + deleted.exams.length === 0;
  const days = deleted?.undoDays ?? 30;

  return (
    <Screen title="Recently deleted">
      <ShellLink to={`/course/${courseId}`} className="text-action" current={false}>
        {name ?? "Course"}
      </ShellLink>
      <p className="note">
        What you deleted in this {words.container} in the last {days} days. Undo brings each back as it was, with your answers counting again.
      </p>
      <UndoOutcome loadError={loadError} error={error} done={done} />
      {deleted === null ? (
        loadError ? null : <p className="note">Loading Recently deleted.</p>
      ) : empty ? (
        <div className="empty-card">
          <EmptyState icon="trash-2" message={`Nothing was deleted in the last ${String(days)} days.`} />
        </div>
      ) : (
        <>
          {deleted.examPages.length > 0 ? (
            <DeletedGroup title="Pages">
              {deleted.examPages.map((page) => (
                <DeletedRow
                  key={page.id}
                  icon="layers"
                  title={page.name}
                  meta={`${pageFolders(page)} · Deleted ${when(page.deletedAt)}`}
                  refusal={page.undoRefusal}
                  busy={busy.has(page.id)}
                  label={`Undo deleting ${page.name}`}
                  onUndo={() => {
                    undo({ kind: "examPage", id: page.id }, page.name);
                  }}
                />
              ))}
            </DeletedGroup>
          ) : null}
          {deleted.folders.length > 0 ? (
            <DeletedGroup title="Folders">
              {deleted.folders.map((folder) => (
                <DeletedRow
                  key={folder.id}
                  icon="folder"
                  title={folder.name}
                  meta={`${folderSets(folder)} · Deleted ${when(folder.deletedAt)}`}
                  refusal={folder.undoRefusal}
                  busy={busy.has(folder.id)}
                  label={`Undo deleting ${folder.name}`}
                  onUndo={() => {
                    undo({ kind: "folder", id: folder.id }, folder.name);
                  }}
                />
              ))}
            </DeletedGroup>
          ) : null}
          {deleted.sets.length > 0 ? (
            <DeletedGroup title="Sets">
              {deleted.sets.map((set) => (
                <DeletedRow
                  key={set.id}
                  title={set.title}
                  meta={`${setMeta(set)} · Deleted ${when(set.deletedAt)}`}
                  refusal={set.undoRefusal}
                  busy={busy.has(set.id)}
                  label={`Undo deleting ${set.title}`}
                  onUndo={() => {
                    undo({ kind: "set", id: set.id }, `“${set.title}”`);
                  }}
                />
              ))}
            </DeletedGroup>
          ) : null}
          {deleted.exams.length > 0 ? (
            <DeletedGroup title="Past exams">
              {deleted.exams.map((exam) => (
                <DeletedRow
                  key={exam.id}
                  title={`${foldersText(exam.weeks)} · ${when(exam.finishedAt ?? exam.startedAt)}`}
                  meta={`${examMeta(exam)} · Deleted ${when(exam.deletedAt)}`}
                  refusal={null}
                  busy={busy.has(exam.id)}
                  label={`Undo deleting the exam over ${foldersText(exam.weeks)}`}
                  onUndo={() => {
                    undo({ kind: "exam", id: exam.id }, "the exam");
                  }}
                />
              ))}
            </DeletedGroup>
          ) : null}
          <p className="group-footer">Each one can be brought back for {days} days after it was deleted. After that it stays deleted.</p>
        </>
      )}
    </Screen>
  );
}

/** The folders Undo puts back on the page: "Week 3, Week 4", or "No folders". */
function pageFolders(page: DeletedExamPage): string {
  if (page.folders.length === 0) return "No folders";
  return foldersText(page.folders.map((folder) => folder.name));
}

/** "Anxiety disorders, Harder A", or "No sets" for an empty folder. */
function folderSets(folder: DeletedFolder): string {
  if (folder.sets.length === 0) return "No sets";
  return foldersText(folder.sets.map((set) => set.title));
}

/** "From Week 4 · 12 questions", with "exam bank" for an exam set. */
function setMeta(set: DeletedSet): string {
  const questions = `${String(set.questionCount)} ${set.questionCount === 1 ? "question" : "questions"}`;
  return `From ${set.folderName}${set.kind === "exam" ? " exam bank" : ""} · ${questions}`;
}

function examMeta(exam: DeletedExam): string {
  return `${String(exam.fullyRight ?? 0)} of ${String(exam.questionCount)} fully right`;
}
