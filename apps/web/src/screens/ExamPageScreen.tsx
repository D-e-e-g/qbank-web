import { useCallback, useEffect, useState } from "react";
import type { CourseDetail, CourseExam, ExamSetup } from "../api";
import { refreshCatalog } from "../catalog";
import { Button } from "../components/Button";
import { DeleteSheet } from "../components/DeleteSheet";
import { EmptyState } from "../components/EmptyState";
import { ExamPageEditor } from "../components/ExamPageEditor";
import { NewFolderSheet } from "../components/FolderSheets";
import { FolderRows } from "../components/FolderRows";
import { Icon } from "../components/Icon";
import { AddMenu, MoreMenu } from "../components/Menu";
import { RowBody } from "../components/NavRow";
import { ReadOnlyBanner } from "../components/ReadOnlyBanner";
import { pageFolders } from "../course/folders";
import { courseName, examSetupPath, examTwinsLine, pageMeta, pageSittings } from "../course/pages";
import { useCourse, useCourseNaming, useRememberPlace } from "../course/useCourse";
import { useFolderOrder } from "../course/useFolderOrder";
import { PastExamList } from "../exam/PastExamList";
import { useSession } from "../login/session-context";
import { importPath, navigate } from "../router";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";

/**
 * One exam page: Start exam over its folders, its folders in her order, and the exams she took over
 * them. More, the "…" beside +, has Edit page, which opens its name, badge and folders directly.
 * Study material's Edit still reorders those folders, and Name and folders stays inside that mode.
 * Its + adds into it: a question file (Import with this page's folders first), a new folder on the
 * page, or folders the course already has. A topic's study page is the same screen, with its primer
 * link when it has one. Its editor ends with Delete: the page goes to Recently deleted, and its
 * folders stay in the course, with their sets, at the end of its Folders list.
 */
export function ExamPageScreen({ courseId, examPageId }: { courseId: string; examPageId: string }) {
  const session = useSession();
  const readOnly = session.user.role !== "student";
  const { course, setup, error, setupError, reload, replace } = useCourse(courseId, true);
  const page = course?.exams.find((item) => item.id === examPageId) ?? null;
  const { name, words } = useCourseNaming(courseId, course);
  const [ordering, setOrdering] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [making, setMaking] = useState(false);
  useRememberPlace(courseId);

  useEffect(() => {
    if (course && page) document.title = `${page.name} · ${courseName(course)} · Qbank`;
  }, [course, page]);

  const closeEditor = useCallback(() => {
    setEditing(false);
  }, []);

  const keep = useCallback(() => {
    setDeleting(false);
  }, []);

  const closeMaking = useCallback(() => {
    setMaking(false);
  }, []);

  const folders = course && page ? pageFolders(course, page.id) : [];
  // An empty page has Add folders instead, so Edit (her order, then its name and folders) waits for one.
  const canEdit = !readOnly && folders.length > 0;
  const edit = ordering && canEdit;
  const order = useFolderOrder({ course, examPageId, folders, replace, reload });

  const header =
    course && page && !readOnly ? (
      <div className="screen-actions">
        <MoreMenu
          name={page.name}
          items={[
            {
              key: "edit",
              label: "Edit page",
              icon: "pencil",
              onSelect: () => {
                setEditing(true);
              },
            },
          ]}
        />
        <AddMenu
          label={`Add to ${page.name}`}
          items={[
            {
              key: "import",
              label: "Import a question file here",
              detail: "A JSON file from your agent",
              icon: "file-input",
              onSelect: () => {
                navigate(importPath(course.id, { examPageId: page.id }));
              },
            },
            {
              key: "folder",
              label: "New folder on this page",
              icon: "folder",
              onSelect: () => {
                setMaking(true);
              },
            },
            {
              key: "existing",
              label: "Add existing folders",
              icon: "plus",
              onSelect: () => {
                setEditing(true);
              },
            },
          ]}
        />
      </div>
    ) : undefined;

  return (
    <Screen title={page?.name ?? "Page"} action={header}>
      {session.user.role === "admin" ? <ReadOnlyBanner /> : null}
      <ShellLink to={`/course/${courseId}`} className="text-action" current={false}>
        {name ?? "Course"}
      </ShellLink>
      {error ? <p className="form-error">{error}</p> : null}
      {order.error ? <p className="form-error">{order.error}</p> : null}
      {course === null ? (
        error ? null : <p className="note">Loading the page.</p>
      ) : page === null ? (
        <div className="empty-card">
          <EmptyState
            icon="layers"
            message={`This page is not in the ${words.container} anymore. If it was deleted, Recently deleted in the ${words.container} can bring it back.`}
          />
        </div>
      ) : (
        <>
          <p className="note">{pageMeta(course, page)}</p>
          {page.linkUrl === null ? null : <PrimerLink url={page.linkUrl} />}
          {readOnly ? null : <StartExam course={course} page={page} setup={setup} />}
          <section className="group">
            <div className="group-head">
              <h2 className="group-header">Study material</h2>
              {canEdit ? (
                <button
                  type="button"
                  className="group-action"
                  aria-label={edit ? "Done editing the page" : "Edit the page"}
                  onClick={() => {
                    setOrdering(!edit);
                  }}
                >
                  {edit ? "Done" : "Edit"}
                </button>
              ) : null}
            </div>
            {edit ? (
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  setEditing(true);
                }}
              >
                <Icon name="pencil" size={18} />
                Name and folders
              </Button>
            ) : null}
            {folders.length === 0 ? (
              <div className="empty-card">
                <EmptyState
                  icon="folder"
                  message={readOnly ? "No folders on this page yet." : "No folders on this page yet. Add the folders this page covers."}
                  action={
                    readOnly ? null : (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditing(true);
                        }}
                      >
                        <Icon name="plus" size={18} strokeWidth={2} />
                        Add folders
                      </Button>
                    )
                  }
                />
              </div>
            ) : (
              <FolderRows courseId={course.id} folders={folders} editing={edit} label={`Study material on ${page.name}`} onMove={order.move} />
            )}
            {edit && folders.length > 1 ? <p className="group-footer">Drag a folder by its handle, or move it up or down.</p> : null}
          </section>
          {setup === null ? (
            <section className="group">
              <h2 className="group-header">{readOnly ? "Her past exams" : "Past exams"}</h2>
              <p className={setupError ? "form-error" : "note"}>{setupError ?? "Loading the exams."}</p>
            </section>
          ) : (
            <PastExamList
              courseId={course.id}
              exams={pageSittings(setup.exams, page.id)}
              title={readOnly ? "Her past exams" : "Past exams"}
              readOnly={readOnly}
              empty={
                <p className="folder-empty">
                  {readOnly ? `Her finished exams over ${page.name} show up here with their scores.` : `Exams you finish over ${page.name} show up here with their scores.`}
                </p>
              }
            />
          )}
        </>
      )}
      {editing && course && page ? (
        <ExamPageEditor
          course={course}
          page={page}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
          onDelete={() => {
            setEditing(false);
            setDeleting(true);
          }}
          onClose={closeEditor}
        />
      ) : null}
      {making && course && page ? (
        <NewFolderSheet
          course={course}
          page={page}
          onMade={() => {
            setMaking(false);
            reload();
            void refreshCatalog();
          }}
          onClose={closeMaking}
        />
      ) : null}
      {deleting && page ? (
        <DeleteSheet
          courseId={courseId}
          items={[{ kind: "examPage", id: page.id }]}
          title={`Delete ${page.name}?`}
          onDeleted={() => {
            navigate(`/course/${courseId}`);
          }}
          onClose={keep}
        />
      ) : null}
    </Screen>
  );
}

/** Start exam, opening Exam setup with the page's folders ticked, and what that exam would draw. */
function StartExam({ course, page, setup }: { course: CourseDetail; page: CourseExam; setup: ExamSetup | null }) {
  // The server leaves out a folder with no question, so the plan names the folders an exam can draw from.
  const preview = setup?.courseExams.find((item) => item.courseExamId === page.id)?.preview ?? null;
  const pool = preview?.folders ?? [];
  if (preview === null || pool.length === 0) return null;
  const total = pool.reduce((sum, folder) => sum + folder.questionCount, 0);
  const where = pool.every((folder) => folder.source === "exam") ? "its exam banks" : pool.length === 1 ? "this folder" : `these ${String(pool.length)} folders`;
  // Twins are what the next exam draws from, not a place to open, so this stays a line under the draw.
  const twins = examTwinsLine(pageFolders(course, page.id));
  return (
    <div className="start-block">
      <ShellLink
        to={examSetupPath(
          course.id,
          page.name,
          pool.map((folder) => folder.id),
        )}
        className="btn btn-primary btn-full"
        current={false}
      >
        <Icon name="timer" size={18} />
        Start exam
      </ShellLink>
      <p className="folder-note">
        {preview.questionCount < total
          ? `${String(preview.questionCount)} questions from the ${String(total)} in ${where}, or wrong questions only.`
          : `All ${String(total)} ${total === 1 ? "question" : "questions"} in ${where}, or wrong questions only.`}
      </p>
      {twins === "" ? null : (
        <p className="folder-bank">
          <Icon name="timer" size={16} />
          {twins}
        </p>
      )}
    </div>
  );
}

/** A study page's primer: the page where she wrote it up, opened in a new tab. Nothing of it is shown here. */
function PrimerLink({ url }: { url: string }) {
  return (
    <ul className="list-group" aria-label="Primer">
      <li>
        <a href={url} className="list-row" target="_blank" rel="noopener noreferrer">
          <RowBody icon="link-2" title="Open the primer" meta={linkHost(url)} />
          <span className="list-chevron">
            <Icon name="chevron-right" size={18} strokeWidth={2} />
          </span>
        </a>
      </li>
    </ul>
  );
}

/** "notes.example.com" for the row's line; the address itself when it does not parse. */
function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
