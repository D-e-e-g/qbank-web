import { useCallback, useEffect, useState } from "react";
import type { CourseDetail } from "../api";
import { refreshCatalog } from "../catalog";
import { RenameCourseSheet } from "../components/CourseSheets";
import { EmptyState } from "../components/EmptyState";
import { ExamPageEditor } from "../components/ExamPageEditor";
import { NewFolderSheet } from "../components/FolderSheets";
import { FolderRows } from "../components/FolderRows";
import { Icon } from "../components/Icon";
import { AddMenu, MoreMenu } from "../components/Menu";
import { NavRow, RowBody } from "../components/NavRow";
import { ReadOnlyBanner } from "../components/ReadOnlyBanner";
import { recentlyDeleted, useCourseVersion } from "../course/deletion";
import { looseFolders } from "../course/folders";
import { badgeLabel, courseName, nextPageName, pageBadge, pageProgress, pageRowMeta } from "../course/pages";
import { useCourse, useCourseNaming, useRememberPlace } from "../course/useCourse";
import { useFolderOrder } from "../course/useFolderOrder";
import { useSession } from "../login/session-context";
import { deletedPath, examPagePath, importPath, navigate } from "../router";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";

/**
 * A course, as in the iPhone's Files app: the study tiles, then two lists. Pages, one row each with
 * its badge, and the folders on no page, one row each, in her order. Each opens its own screen.
 * More, the "…" beside +, renames it: a course's code and name, or a topic's name. Its folders,
 * sets and progress stay. Its + adds into it: a question file (Import with the course picked), a
 * folder, or a page. A study topic is the same screen, called by its name.
 */
export function CourseScreen({ courseId }: { courseId: string }) {
  const session = useSession();
  const readOnly = session.user.role !== "student";
  const { course, error, reload, replace } = useCourse(courseId);
  const [ordering, setOrdering] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [making, setMaking] = useState<"page" | "folder" | null>(null);
  const deleted = useRecentlyDeleted(courseId);
  const { name, words } = useCourseNaming(courseId, course);
  useRememberPlace(courseId);

  useEffect(() => {
    if (course) document.title = `${courseName(course)} · Qbank`;
  }, [course]);

  const closeSheet = useCallback(() => {
    setMaking(null);
  }, []);

  const closeRename = useCallback(() => {
    setRenaming(false);
  }, []);

  const loose = course ? looseFolders(course) : [];
  const order = useFolderOrder({ course, examPageId: null, folders: loose, replace, reload });
  // Ordering needs two folders; if another device leaves one, edit mode ends with its Done button.
  const editing = ordering && !readOnly && loose.length > 1;

  const header =
    course && !readOnly ? (
      <div className="screen-actions">
        <MoreMenu
          name={courseName(course)}
          items={[
            {
              key: "rename",
              label: "Rename",
              icon: "pencil",
              onSelect: () => {
                setRenaming(true);
              },
            },
          ]}
        />
        <AddMenu
          label={`Add to ${courseName(course)}`}
          items={[
            {
              key: "import",
              label: "Import a question file",
              detail: "A JSON file from your agent",
              icon: "file-input",
              onSelect: () => {
                navigate(importPath(course.id));
              },
            },
            {
              key: "folder",
              label: "New folder",
              icon: "folder",
              onSelect: () => {
                setMaking("folder");
              },
            },
            {
              key: "page",
              label: "New page",
              icon: "layers",
              onSelect: () => {
                setMaking("page");
              },
            },
          ]}
        />
      </div>
    ) : undefined;

  return (
    <Screen title={name ?? "Course"} action={header}>
      {session.user.role === "admin" ? <ReadOnlyBanner /> : null}
      <ShellLink to="/" className="text-action" current={false}>
        {words.home}
      </ShellLink>
      {error ? <p className="form-error">{error}</p> : null}
      {course ? (
        <>
          <p className="note">
            {/* A topic's name is its title already. */}
            {course.kind === "topic" ? null : `${course.title} · `}
            {plural(course.questionCount, "question")} · {plural(course.folders.length, "folder")}
            {course.answeredCount > 0 ? (
              <>
                <br />
                {scoreLine(course)}
              </>
            ) : null}
          </p>
          <div className="tile-row">
            <ShellLink to={`/course/${course.id}/exam`} className="study-tile" current={false}>
              <Icon name="timer" size={22} />
              <span className="tile-copy">
                <span className="tile-value">Exam</span>
                <span className="tile-label">{examLine(course)}</span>
              </span>
            </ShellLink>
            <ShellLink to={`/course/${course.id}/review`} className="study-tile" current={false}>
              <Icon name="inbox" size={22} />
              <span className="tile-copy">
                <span className="tile-value">{course.reviewCount}</span>
                <span className="tile-label">to review</span>
              </span>
            </ShellLink>
            <ShellLink to={`/course/${course.id}/terms`} className="study-tile" current={false}>
              <Icon name="book-open" size={22} />
              <span className="tile-copy">
                <span className="tile-value">{course.termCount}</span>
                <span className="tile-label">{course.termCount === 1 ? "term" : "terms"}</span>
              </span>
            </ShellLink>
          </div>
          {course.folders.length === 0 && course.exams.length === 0 ? (
            <div className="empty-card">
              <EmptyState
                icon="layers"
                message={readOnly ? `This ${words.container} has no question sets yet.` : `This ${words.container} has no question sets yet. Tap + to import a question file.`}
              />
            </div>
          ) : (
            <>
              <section className="group">
                <h2 className="group-header">Pages</h2>
                {course.exams.length === 0 ? (
                  <p className="folder-empty">{readOnly ? "No pages yet." : `No pages yet. Tap + to make ${nextPageName(course.exams)}.`}</p>
                ) : (
                  <ul className="list-group" aria-label="Pages">
                    {course.exams.map((page) => {
                      const badge = pageBadge(page);
                      return (
                        <li key={page.id}>
                          <NavRow
                            to={examPagePath(course.id, page.id)}
                            icon="layers"
                            title={page.name}
                            strong
                            tag={badge === null ? null : badgeLabel(badge)}
                            meta={pageRowMeta(course, page)}
                            progress={pageProgress(course, page)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              {loose.length > 0 ? (
                <section className="group">
                  <div className="group-head">
                    <h2 className="group-header">Folders</h2>
                    {readOnly || loose.length < 2 ? null : (
                      <button
                        type="button"
                        className="group-action"
                        aria-label={editing ? "Done ordering folders" : "Edit folder order"}
                        onClick={() => {
                          setOrdering(!editing);
                        }}
                      >
                        {editing ? "Done" : "Edit"}
                      </button>
                    )}
                  </div>
                  <FolderRows courseId={course.id} folders={loose} editing={editing} label="Folders" onMove={order.move} />
                  {order.error ? <p className="form-error">{order.error}</p> : null}
                  <p className="group-footer">
                    {editing
                      ? "Drag a folder by its handle, or move it up or down."
                      : course.exams.length === 0
                        ? "Open a folder to see its sets."
                        : "Folders on no page. Open one to see its sets."}
                  </p>
                </section>
              ) : null}
            </>
          )}
          {deleted !== null && deleted.count > 0 ? (
            <section className="group">
              <ul className="list-group" aria-label="Recently deleted">
                <li>
                  <ShellLink to={deletedPath(course.id)} className="list-row" current={false}>
                    <RowBody icon="trash-2" title="Recently deleted" meta={`${plural(deleted.count, "item")} · Undo for ${String(deleted.undoDays)} days`} />
                    <span className="list-chevron">
                      <Icon name="chevron-right" size={18} strokeWidth={2} />
                    </span>
                  </ShellLink>
                </li>
              </ul>
            </section>
          ) : null}
        </>
      ) : error ? null : (
        <p className="note">Loading the {words.container}.</p>
      )}
      {renaming && course ? (
        <RenameCourseSheet
          course={course}
          onSaved={() => {
            setRenaming(false);
            reload();
          }}
          onClose={closeRename}
        />
      ) : null}
      {making === "page" && course ? (
        <ExamPageEditor
          course={course}
          page={null}
          onSaved={(page) => {
            navigate(examPagePath(course.id, page.id));
          }}
          onClose={closeSheet}
        />
      ) : null}
      {making === "folder" && course ? (
        <NewFolderSheet
          course={course}
          page={null}
          onMade={() => {
            setMaking(null);
            reload();
            void refreshCatalog();
          }}
          onClose={closeSheet}
        />
      ) : null}
    </Screen>
  );
}

/** How many pages, folders, sets and past exams of the course Undo can still bring back, and for how long; null until it is read. */
function useRecentlyDeleted(courseId: string): { count: number; undoDays: number } | null {
  const version = useCourseVersion(courseId);
  const [loaded, setLoaded] = useState<{ courseId: string; count: number; undoDays: number } | null>(null);
  useEffect(() => {
    let cancel = false;
    recentlyDeleted(courseId).then(
      (deleted) => {
        if (!cancel) {
          const count = deleted.examPages.length + deleted.folders.length + deleted.sets.length + deleted.exams.length;
          setLoaded({ courseId, count, undoDays: deleted.undoDays });
        }
      },
      (caught: unknown) => {
        console.error(caught);
      },
    );
    return () => {
      cancel = true;
    };
  }, [courseId, version]);
  return loaded?.courseId === courseId ? loaded : null;
}

/** How long an exam over every folder takes: 60 minutes for 40, or 1.5 minutes a question when there are fewer. */
function examLine(course: CourseDetail): string {
  if (course.examQuestionCount === 0) return "Not ready";
  const minutes = course.examTimeLimitSeconds / 60;
  return `${Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1)} min`;
}

function scoreLine(course: CourseDetail): string {
  return `${String(course.answeredCount)} of ${String(course.questionCount)} answered · ${String(course.fullyRightCount)} fully right · ${String(course.points)} of ${String(course.maxPoints)} points`;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${count === 1 ? noun : `${noun}s`}`;
}
