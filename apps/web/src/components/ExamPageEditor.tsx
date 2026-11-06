import { useState } from "react";
import { ApiError, type CourseDetail, type CourseExam, type CourseFolder, type PageBadge } from "../api";
import { looseFolders, pageFolders } from "../course/folders";
import { BADGE_CHOICES, chipState, kindWords, nextPageName, pageBadge, pickedSummary } from "../course/pages";
import { createExamPage, updateExamPage } from "../course/requests";
import { FormSheet } from "./FormSheet";
import { SegmentedControl } from "./SegmentedControl";

/**
 * A new page, or an existing one's name, folders and badge, with the course's folders as chips. A
 * folder on another page is greyed and names it, so no folder is on two. A topic's page also takes
 * its primer link. A new page asks for no badge: it has none until she sets one here. Nothing is
 * saved until Done.
 */
export function ExamPageEditor({
  course,
  page,
  onSaved,
  onClose,
}: {
  course: CourseDetail;
  /** The page to edit, or null for a new one. */
  page: CourseExam | null;
  onSaved: (page: CourseExam) => void;
  onClose: () => void;
}) {
  const words = kindWords(course.kind);
  const topic = course.kind === "topic";
  const [name, setName] = useState(page?.name ?? nextPageName(course.exams));
  const [link, setLink] = useState(page?.linkUrl ?? "");
  const [badge, setBadge] = useState<PageBadge | null>(page === null ? null : pageBadge(page));
  const [picked, setPicked] = useState<string[]>(() => (page === null ? [] : pageFolders(course, page.id).map((folder) => folder.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = page?.id ?? null;
  // A server from before badges sends no badge field and would drop a choice, so Badge waits for one that does.
  const badged = page?.badge !== undefined;
  // Its own folders first, then the ones on no page, then the ones other pages hold.
  const others = course.exams.filter((other) => other.id !== editing).flatMap((other) => pageFolders(course, other.id));
  const chips: CourseFolder[] = [...(editing === null ? [] : pageFolders(course, editing)), ...looseFolders(course), ...others];

  const save = () => {
    const next = name.trim();
    if (next === "") {
      setError("Give the page a name.");
      return;
    }
    setBusy(true);
    setError(null);
    // A course's page has no link field, so saving it leaves its link as it is.
    const linkUrl = topic ? link.trim() || null : undefined;
    const saving = page === null ? createExamPage(course.id, next, picked, linkUrl) : updateExamPage(page.id, next, picked, linkUrl, badged ? badge : undefined);
    saving.then(onSaved, (caught: unknown) => {
      setBusy(false);
      setError(caught instanceof ApiError ? caught.message : "Could not save the page.");
    });
  };

  return (
    <FormSheet title={page === null ? "New page" : "Edit page"} busy={busy} error={error} onDone={save} onClose={onClose}>
      <div className="exam-edit">
        <label className="field">
          <span className="field-label">Page name</span>
          <input
            className="control exam-edit-input"
            aria-label="Page name"
            value={name}
            maxLength={80}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        {chips.length > 0 ? (
          <div className="folder-chips" role="group" aria-label="Folders on this page">
            {chips.map((folder) => {
              const state = chipState(course, editing, picked, folder.id);
              return (
                <button
                  key={folder.id}
                  type="button"
                  className="folder-chip"
                  aria-pressed={state.kind === "on"}
                  disabled={state.kind === "taken"}
                  onClick={() => {
                    setPicked((list) => (list.includes(folder.id) ? list.filter((id) => id !== folder.id) : [...list, folder.id]));
                  }}
                >
                  {folder.name}
                  {state.kind === "taken" ? <small className="folder-chip-owner">{state.pageName}</small> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="exam-edit-summary">This {words.container} has no folders yet.</p>
        )}
        <p className="exam-edit-summary">{pickedSummary(course, picked)}</p>
      </div>
      <p className="sheet-hint">Tap the folders on this page. A folder on another page is greyed and says which.</p>
      {topic ? (
        <label className="field">
          <span className="field-label">Primer link</span>
          <input
            className="control"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Primer link"
            placeholder="https://"
            value={link}
            maxLength={2000}
            onChange={(event) => {
              setLink(event.target.value);
            }}
          />
          <span className="field-hint">Where you wrote this page up. The page opens it; leave it empty for none.</span>
        </label>
      ) : null}
      {badged ? (
        <div className="field">
          <span className="field-label">Badge</span>
          <SegmentedControl
            label="Badge"
            value={badge ?? "none"}
            options={BADGE_CHOICES}
            onChange={(value) => {
              setBadge(value === "none" ? null : value);
            }}
          />
          <span className="field-hint">Says what the page is for</span>
        </div>
      ) : null}
    </FormSheet>
  );
}
