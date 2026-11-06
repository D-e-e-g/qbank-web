import { useEffect, useState } from "react";
import { ApiError, api, type SetSummary } from "../api";
import { refreshCatalog } from "../catalog";
import { Button } from "../components/Button";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { EmptyState } from "../components/EmptyState";
import { DeleteSheet } from "../components/DeleteSheet";
import { FolderPageSheet, MoveSetsSheet, RenameFolderSheet } from "../components/FolderSheets";
import { Icon } from "../components/Icon";
import { MoreMenu } from "../components/Menu";
import { ReadOnlyBanner } from "../components/ReadOnlyBanner";
import { examPageOf, folderEmptyMessage, folderMeta, folderPlace } from "../course/folders";
import { courseName } from "../course/pages";
import { useCourse, useCourseNaming, useRememberPlace } from "../course/useCourse";
import { useSession } from "../login/session-context";
import { examPagePath, importPath, navigate } from "../router";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";
import { statusLine } from "./set-status";

type Sheet = "rename" | "page" | "move" | "delete" | "delete-sets" | null;

/**
 * One folder. At the title, + opens Import with this folder picked, and More, the "…", renames it,
 * changes its page, or deletes it (with its sets, after a warning naming them). Under the title, its
 * sets, which open in practice, and its exam bank. Select puts a check circle on each set, and a bar
 * at the bottom moves the ones she ticks to another folder or deletes them.
 */
export function FolderScreen({ courseId, folderId }: { courseId: string; folderId: string }) {
  const session = useSession();
  const readOnly = session.user.role !== "student";
  const { course, error, reload } = useCourse(courseId);
  const folder = course?.folders.find((item) => item.id === folderId) ?? null;
  const page = course && folder ? examPageOf(course, folder) : null;
  const { name, words } = useCourseNaming(courseId, course);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const [restore, setRestore] = useState<SetSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  useRememberPlace(courseId);

  useEffect(() => {
    if (course && folder) document.title = `${folder.name} · ${courseName(course)} · Qbank`;
  }, [course, folder]);

  const close = () => {
    setSheet(null);
  };

  const saved = () => {
    setSheet(null);
    reload();
  };

  const dismissRestore = () => {
    setRestore(null);
  };

  const confirmRestore = () => {
    if (!restore) return;
    const setId = restore.id;
    setRestore(null);
    void api(`/api/practice-sets/${setId}/restore`, { method: "POST" })
      .then(() => {
        reload();
        return refreshCatalog();
      })
      .catch((caught: unknown) => {
        setActionError(caught instanceof ApiError ? caught.message : "Could not restore that set.");
      });
  };

  const back = page === null ? { to: `/course/${courseId}`, label: name ?? "Course" } : { to: examPagePath(courseId, page.id), label: page.name };

  const sets = folder?.sets ?? [];
  const picked = sets.filter((set) => selected?.has(set.id) === true);
  const selecting = selected !== null && !readOnly;
  const importHere = importPath(courseId, { folderId });

  const header =
    folder && !readOnly ? (
      <div className="screen-actions">
        <MoreMenu
          name={folder.name}
          items={[
            {
              key: "rename",
              label: "Rename",
              icon: "pencil",
              onSelect: () => {
                setSheet("rename");
              },
            },
            {
              key: "page",
              label: "Change page",
              detail: folderPlace(page),
              icon: "layers",
              onSelect: () => {
                setSheet("page");
              },
            },
            {
              key: "delete",
              label: "Delete folder",
              icon: "trash-2",
              destructive: true,
              separated: true,
              onSelect: () => {
                setSheet("delete");
              },
            },
          ]}
        />
        <ShellLink to={importHere} className="add-button" current={false} label="Import here">
          <Icon name="plus" size={22} strokeWidth={2} />
        </ShellLink>
      </div>
    ) : undefined;

  return (
    <Screen title={folder?.name ?? "Folder"} action={header}>
      {session.user.role === "admin" ? <ReadOnlyBanner /> : null}
      <ShellLink to={back.to} className="text-action" current={false}>
        {back.label}
      </ShellLink>
      {error ? <p className="form-error">{error}</p> : null}
      {actionError ? <p className="form-error">{actionError}</p> : null}
      {course === null ? (
        error ? null : <p className="note">Loading the folder.</p>
      ) : folder === null ? (
        <div className="empty-card">
          <EmptyState
            icon="folder"
            message={`This folder is not in the ${words.container} anymore. If it was deleted, Recently deleted in the ${words.container} can bring it back.`}
          />
        </div>
      ) : (
        <>
          <p className="note">
            {folderPlace(page)} · {folderMeta(folder)}
          </p>
          {moved ? (
            <p className="status-banner" role="status">
              <Icon name="check" size={16} strokeWidth={2} />
              <span>{moved}</span>
            </p>
          ) : null}
          <section className="group">
            <div className="group-head">
              <h2 className="group-header">Sets</h2>
              {readOnly || sets.length === 0 ? null : (
                <button
                  type="button"
                  className="group-action"
                  aria-label={selecting ? "Cancel selecting sets" : "Select sets"}
                  onClick={() => {
                    setSelected(selecting ? null : new Set());
                    setMoved(null);
                  }}
                >
                  {selecting ? "Cancel" : "Select"}
                </button>
              )}
            </div>
            {sets.length === 0 ? (
              <div className="folder-empty folder-empty-import">
                <p>{folderEmptyMessage(folder, readOnly)}</p>
                {readOnly ? null : (
                  <ShellLink to={importHere} className="btn btn-secondary" current={false}>
                    <Icon name="file-input" size={18} strokeWidth={2} />
                    Import here
                  </ShellLink>
                )}
              </div>
            ) : (
              <ul className={selecting ? "list-group list-group-picking" : "list-group list-group-sets"} aria-label={`Sets in ${folder.name}`}>
                {sets.map((set) => (
                  <li key={set.id}>
                    {selecting ? (
                      <label className="list-row list-row-pick">
                        <input
                          type="checkbox"
                          className="pick-input"
                          checked={selected.has(set.id)}
                          onChange={(event) => {
                            const on = event.target.checked;
                            setSelected((current) => {
                              const next = new Set(current);
                              if (on) next.add(set.id);
                              else next.delete(set.id);
                              return next;
                            });
                          }}
                        />
                        <span className="pick-circle" aria-hidden="true">
                          <Icon name="check" size={14} strokeWidth={3} />
                        </span>
                        <SetCopy set={set} />
                      </label>
                    ) : readOnly ? (
                      <div className="list-row">
                        <SetCopy set={set} />
                      </div>
                    ) : (
                      <ShellLink to={`/course/${courseId}/practice/${set.id}?folder=${folder.id}`} className="list-row" current={false}>
                        <SetCopy set={set} opens />
                        <span className="list-chevron">
                          <Icon name="chevron-right" size={18} strokeWidth={2} />
                        </span>
                      </ShellLink>
                    )}
                    {set.canRestore && !selecting ? (
                      <div className="list-row-extra">
                        <Button
                          variant="secondary"
                          aria-label={`Restore the previous “${set.title}”`}
                          onClick={() => {
                            setRestore(set);
                          }}
                        >
                          Restore
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {folder.examBankCount > 0 ? (
              <p className="folder-bank">
                <Icon name="timer" size={16} />
                Exam twins: {folder.examBankCount} {folder.examBankCount === 1 ? "question" : "questions"}, exams only
              </p>
            ) : null}
          </section>
          {selecting && picked.length > 0 ? (
            <div className="action-bar">
              <div className="action-bar-inner action-bar-pair">
                <Button
                  variant="destructive"
                  aria-label={`Delete ${String(picked.length)} ${picked.length === 1 ? "set" : "sets"}`}
                  onClick={() => {
                    setSheet("delete-sets");
                  }}
                >
                  <Icon name="trash-2" size={18} strokeWidth={2} />
                  Delete
                </Button>
                <Button
                  fullWidth
                  onClick={() => {
                    setSheet("move");
                  }}
                >
                  <Icon name="move" size={18} strokeWidth={2} />
                  Move {picked.length} {picked.length === 1 ? "set" : "sets"}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
      {sheet === "rename" && folder ? <RenameFolderSheet folder={folder} onSaved={saved} onClose={close} /> : null}
      {sheet === "page" && course && folder ? <FolderPageSheet course={course} folder={folder} onSaved={saved} onChanged={reload} onClose={close} /> : null}
      {sheet === "move" && course && folder ? (
        <MoveSetsSheet
          course={course}
          from={folder}
          setIds={picked.map((set) => set.id)}
          onMoved={(name) => {
            setSheet(null);
            setSelected(null);
            setMoved(picked.length === 1 && picked[0] !== undefined ? `Moved “${picked[0].title}” to ${name}.` : `Moved ${String(picked.length)} sets to ${name}.`);
            reload();
            void refreshCatalog();
          }}
          onChanged={reload}
          onClose={close}
        />
      ) : null}
      {sheet === "delete" && folder ? (
        <DeleteSheet
          courseId={courseId}
          items={[{ kind: "folder", id: folder.id }]}
          title={`Delete ${folder.name}?`}
          onDeleted={() => {
            navigate(back.to);
          }}
          onClose={close}
        />
      ) : null}
      {sheet === "delete-sets" && picked.length > 0 ? (
        <DeleteSheet
          courseId={courseId}
          items={picked.map((set) => ({ kind: "set", id: set.id }))}
          title={picked.length === 1 && picked[0] !== undefined ? `Delete ${picked[0].title}?` : `Delete ${String(picked.length)} sets?`}
          onDeleted={() => {
            setSheet(null);
            setSelected(null);
            setMoved(null);
          }}
          onClose={close}
        />
      ) : null}
      {restore ? (
        <ConfirmSheet
          title={`Restore the previous “${restore.title}”?`}
          message="The set you are looking at stays saved. Restoring brings the previous version back, and you can swap again."
          confirmLabel="Restore"
          onConfirm={confirmRestore}
          onCancel={dismissRestore}
        />
      ) : null}
    </Screen>
  );
}

/** A set's title and status. On a row that opens the set (`opens`), one she left midway offers Continue. */
function SetCopy({ set, opens = false }: { set: SetSummary; opens?: boolean }) {
  const admin = useSession().user.role === "admin";
  return (
    <span className="list-copy">
      <span className="list-title list-title-strong">{set.title}</span>
      <span className="list-meta">
        {statusLine(set)}
        {opens && set.sitting ? (
          <>
            {" "}
            <span className="list-meta-sep">·</span> <span className="list-continue">Continue</span>
          </>
        ) : null}
      </span>
      {set.importedByAgent === null ? null : <span className="list-meta">{admin ? "Imported by an agent" : "Imported by your agent"}</span>}
    </span>
  );
}
