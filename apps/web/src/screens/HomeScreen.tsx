import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import type { CourseLink, SemesterGroup } from "../catalog";
import { homeLayout, refreshCatalog, useCatalog } from "../catalog";
import { NewCourseSheet, RenameCourseSheet } from "../components/CourseSheets";
import { DeleteSheet } from "../components/DeleteSheet";
import { EmptyState } from "../components/EmptyState";
import { Icon, type IconName } from "../components/Icon";
import { AddMenu, Menu, type MenuAnchor, type MenuItem } from "../components/Menu";
import { RowBody } from "../components/NavRow";
import { NewTopicSheet } from "../components/NewTopicSheet";
import { Notice, type NoticeMessage } from "../components/Notice";
import { recentlyDeletedCourses, useCoursesVersion } from "../course/deletion";
import { courseName } from "../course/pages";
import { saveTopicOrder } from "../course/requests";
import { cardActionLabel, cardActions, homeAdds, semesterOf, topicOrderAfterMove, type CardAction, type HomeAdd } from "../home/menus";
import { useFrozen } from "../frozen";
import { DELETED_COURSES_PATH, navigate } from "../router";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";

type Sheet = { kind: "course"; semester: SemesterGroup } | { kind: "topic" } | { kind: "rename"; course: CourseLink } | { kind: "delete"; course: CourseLink } | null;

const ADD_ICONS: Record<HomeAdd["kind"], IconName> = { course: "graduation-cap", topic: "book-marked", semester: "calendar" };

const ACTION_ICONS: Record<CardAction["kind"], IconName> = {
  open: "arrow-right",
  rename: "pencil",
  move: "move",
  up: "chevron-up",
  down: "chevron-down",
  archive: "archive",
  unarchive: "archive-restore",
  delete: "trash-2",
};

/**
 * Her semesters with their courses, her study topics, and what she archived. One + at the top adds
 * a course to a semester, a topic, or the next semester; each card's "…" (or a right-click) opens,
 * renames, moves, archives or deletes it. Recently deleted, last, brings a deleted course or topic
 * back for 30 days.
 */
export function HomeScreen() {
  const { guard } = useFrozen();
  const catalog = useCatalog();
  const editable = catalog.fromServer;
  const [sheet, setSheet] = useState<Sheet>(null);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const notices = useRef(0);
  const close = useCallback(() => {
    setSheet(null);
  }, []);
  const dismiss = useCallback((id: number) => {
    setNotice((current) => (current?.id === id ? null : current));
  }, []);
  const { semesters, topics, archived } = homeLayout(catalog);
  const deleted = useDeletedCourses();

  const say = (text: string, icon: IconName, extra: Partial<NoticeMessage> = {}) => {
    notices.current += 1;
    setNotice({ id: notices.current, text, icon, ...extra });
  };

  /** Saves one change, reads Home again, and says what happened, or the server's refusal. */
  const change = (work: () => Promise<unknown>, done?: () => void) => {
    void work()
      .then(async () => {
        await refreshCatalog();
        done?.();
      })
      .catch((caught: unknown) => {
        say(caught instanceof ApiError ? caught.message : "Could not save that. Try again.", "circle-alert", { failed: true });
      });
  };

  const patch = (course: CourseLink, json: Record<string, unknown>) => () => api(`/api/courses/${course.id}`, { method: "PATCH", json });

  const add = (item: HomeAdd) => {
    if (item.kind === "course") setSheet({ kind: "course", semester: item.semester });
    else if (item.kind === "topic") setSheet({ kind: "topic" });
    else change(() => api("/api/semesters", { method: "POST", json: { number: item.number } }));
  };

  const act = (course: CourseLink, action: CardAction) => {
    const name = courseName(course);
    switch (action.kind) {
      case "open":
        navigate(`/course/${course.id}`);
        return;
      case "rename":
        setSheet({ kind: "rename", course });
        return;
      case "move": {
        const from = semesterOf(course, catalog.semesters);
        change(patch(course, { semesterId: action.semester.id }), () => {
          say(`Moved ${name} to ${action.semester.label}.`, "move", from === undefined ? {} : { undo: () => { change(patch(course, { semesterId: from.id })); } });
        });
        return;
      }
      case "up":
      case "down":
        change(() => saveTopicOrder(topicOrderAfterMove(catalog.topics, course.id, action.kind === "up" ? -1 : 1)));
        return;
      case "archive":
        change(patch(course, { archived: true }), () => {
          say(`Archived ${name}. It is in Archived at the bottom of Home.`, "archive", { undo: () => { change(patch(course, { archived: false })); } });
        });
        return;
      case "unarchive":
        change(patch(course, { archived: false }));
        return;
      case "delete":
        // Undo for the delete shows where this notice would, so an older notice gives way.
        setNotice(null);
        setSheet({ kind: "delete", course });
        return;
    }
  };

  const actionsFor = editable
    ? (course: CourseLink): MenuItem[] =>
        cardActions(course, catalog).map((action) => ({
          key: action.kind === "move" ? `move-${action.semester.id}` : action.kind,
          label: cardActionLabel(action),
          icon: ACTION_ICONS[action.kind],
          destructive: action.kind === "delete",
          onSelect: () => {
            // Open only reads, so it opens in the frozen view too.
            if (action.kind === "open") act(course, action);
            else guard(act)(course, action);
          },
        }))
    : undefined;

  const addItems: MenuItem[] = homeAdds(catalog).map((item) => ({
    key: item.kind === "course" ? `course-${item.semester.id}` : item.kind,
    label: item.label,
    icon: ADD_ICONS[item.kind],
    onSelect: () => {
      guard(add)(item);
    },
  }));

  return (
    <Screen title="Home" action={editable ? <AddMenu label="Add" items={addItems} /> : undefined}>
      {semesters.map(({ semester, courses }) => (
        <section key={semester.id} className="semester">
          <h2 className="semester-label">{semester.label}</h2>
          {courses.length === 0 ? (
            <div className="empty-card">
              <EmptyState icon="layers" message={editable ? "No courses yet. Tap + to add one, or import its first question file." : "No courses yet."} />
            </div>
          ) : (
            <CourseCards courses={courses} actionsFor={actionsFor} />
          )}
        </section>
      ))}
      <section className="semester">
        <h2 className="semester-label">Study topics</h2>
        {topics.length === 0 ? (
          <div className="empty-card">
            <EmptyState icon="book-marked" message="A topic is a place for questions that are not a course: a certification, a language, your own notes." />
          </div>
        ) : (
          <CourseCards courses={topics} actionsFor={actionsFor} />
        )}
      </section>
      {archived.length > 0 ? (
        <details className="archived">
          <summary className="archived-summary">
            <span className="semester-label">Archived</span>
            <Icon name="chevron-right" size={18} strokeWidth={2} />
          </summary>
          <div className="archived-groups">
            {archived.map((group) => (
              <section key={group.key} className="group">
                <h3 className="group-header">{group.title}</h3>
                {group.courses.length === 0 ? <p className="folder-empty">No courses.</p> : <CourseCards courses={group.courses} actionsFor={actionsFor} />}
              </section>
            ))}
          </div>
        </details>
      ) : null}
      {deleted !== null && deleted.count > 0 ? (
        <section className="group">
          <ul className="list-group" aria-label="Recently deleted">
            <li>
              <ShellLink to={DELETED_COURSES_PATH} className="list-row" current={false}>
                <RowBody icon="trash-2" title="Recently deleted" meta={`${plural(deleted.count, "item")} · Undo for ${String(deleted.undoDays)} days`} />
                <span className="list-chevron">
                  <Icon name="chevron-right" size={18} strokeWidth={2} />
                </span>
              </ShellLink>
            </li>
          </ul>
        </section>
      ) : null}
      {sheet?.kind === "course" ? (
        <NewCourseSheet
          semester={sheet.semester}
          onMade={(course) => {
            setSheet(null);
            navigate(`/course/${course.id}`);
          }}
          onClose={close}
        />
      ) : null}
      {sheet?.kind === "topic" ? (
        <NewTopicSheet
          onMade={(topic) => {
            setSheet(null);
            navigate(`/course/${topic.id}`);
          }}
          onClose={close}
        />
      ) : null}
      {sheet?.kind === "rename" ? <RenameCourseSheet course={sheet.course} onSaved={close} onClose={close} /> : null}
      {sheet?.kind === "delete" ? (
        <DeleteSheet
          courseId={sheet.course.id}
          items={[{ kind: "course", id: sheet.course.id }]}
          title={`Delete ${courseName(sheet.course)}?`}
          onDeleted={close}
          onClose={close}
        />
      ) : null}
      <Notice notice={notice} onDismiss={dismiss} />
    </Screen>
  );
}

/** How many courses and topics Undo can still bring back, and for how long; null until it is read. */
function useDeletedCourses(): { count: number; undoDays: number } | null {
  const version = useCoursesVersion();
  const [loaded, setLoaded] = useState<{ count: number; undoDays: number } | null>(null);
  useEffect(() => {
    let cancel = false;
    recentlyDeletedCourses().then(
      (deleted) => {
        if (!cancel) setLoaded({ count: deleted.courses.length, undoDays: deleted.undoDays });
      },
      (caught: unknown) => {
        console.error(caught);
      },
    );
    return () => {
      cancel = true;
    };
  }, [version]);
  return loaded;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${count === 1 ? noun : `${noun}s`}`;
}

/**
 * Course cards; a topic's card is called by its name alone, as a course's is by its code and name.
 * With `actionsFor`, each card has a "…" and a right-click menu.
 */
function CourseCards({ courses, actionsFor }: { courses: readonly CourseLink[]; actionsFor: ((course: CourseLink) => MenuItem[]) | undefined }) {
  return (
    <ul className="course-list">
      {courses.map((course) => (
        <CourseCard key={course.id} course={course} actionsFor={actionsFor} />
      ))}
    </ul>
  );
}

function CourseCard({ course, actionsFor }: { course: CourseLink; actionsFor: ((course: CourseLink) => MenuItem[]) | undefined }) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const closeMenu = useCallback(() => {
    setAnchor(null);
  }, []);
  const name = courseName(course);
  return (
    <li
      className={actionsFor === undefined ? undefined : anchor === null ? "course-item" : "course-item course-item-open"}
      onContextMenu={
        actionsFor === undefined
          ? undefined
          : (event) => {
              event.preventDefault();
              setAnchor({ x: event.clientX, y: event.clientY });
            }
      }
    >
      <ShellLink to={`/course/${course.id}`} className="course-card" current={false}>
        {course.kind === "topic" ? null : <span className="course-code">{course.code}</span>}
        <span className="course-card-title">{course.title}</span>
        <span className="course-meta course-meta-row">
          <span>
            {course.questionCount} {course.questionCount === 1 ? "question" : "questions"} · {course.folderCount}{" "}
            {course.folderCount === 1 ? "folder" : "folders"}
          </span>
          {course.reviewCount > 0 ? (
            <span className="review-pill">
              <Icon name="inbox" size={14} />
              {course.reviewCount} to review
            </span>
          ) : null}
        </span>
        <CourseProgress course={course} />
      </ShellLink>
      {actionsFor === undefined ? null : (
        <>
          <button
            type="button"
            className="card-more"
            aria-label={`Actions for ${name}`}
            aria-haspopup="menu"
            aria-expanded={anchor !== null}
            onClick={(event) => {
              setAnchor(anchor === null ? { element: event.currentTarget } : null);
            }}
          >
            <Icon name="ellipsis" size={20} strokeWidth={2} />
          </button>
          {anchor === null ? null : <Menu label={name} anchor={anchor} items={actionsFor(course)} onClose={closeMenu} />}
        </>
      )}
    </li>
  );
}

function CourseProgress({ course }: { course: CourseLink }) {
  const total = course.questionCount;
  const answered = Math.min(course.answeredCount, total);
  const pct = total === 0 ? 0 : Math.round((answered / total) * 100);
  return (
    <span className="course-progress">
      <span
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${String(pct)}% answered`}
      >
        <span className="progress-fill" style={{ width: `${String(pct)}%` }} />
      </span>
      <span className="progress-pct" aria-hidden="true">
        {pct}%
      </span>
    </span>
  );
}
