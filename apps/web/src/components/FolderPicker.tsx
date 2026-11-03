import { useId } from "react";
import type { CourseDetail } from "../api";
import { folderGroups } from "../course/folders";
import type { FolderChoice } from "../make/states";
import { Icon } from "./Icon";

/** The folder the server files a set under when she picks none. */
export const UNSORTED = "Unsorted";

/** The folder Import and Make questions file a set under: Unsorted unless she picks one of hers, grouped by page, or names a new one. */
export function FolderPicker({
  course,
  firstPageId,
  value,
  newName,
  onChange,
  onNewName,
}: {
  /** The picked course, or null for a new course and while it loads. */
  course: CourseDetail | null;
  /** The page it was opened from, whose folders come first. */
  firstPageId: string | null;
  value: FolderChoice;
  newName: string;
  onChange: (choice: FolderChoice) => void;
  onNewName: (name: string) => void;
}) {
  const labelId = useId();
  const name = useId();
  const groups = course === null ? [] : folderGroups(course, firstPageId);
  // Her Unsorted is the first chip, so it is not listed again with the other folders on no page.
  const unsorted = course?.folders.find((folder) => folder.examPageId === null && folder.name === UNSORTED) ?? null;
  const picked = (choice: FolderChoice) => choice.kind === value.kind && (choice.kind !== "folder" || (value.kind === "folder" && value.id === choice.id));
  const chip = (choice: FolderChoice, label: string, extra?: string) => (
    <label key={choice.kind === "folder" ? choice.id : choice.kind} className="folder-chip">
      <input
        type="radio"
        className="radio-input"
        name={name}
        checked={picked(choice)}
        onChange={() => {
          onChange(choice);
        }}
      />
      {choice.kind === "new" ? <Icon name="plus" size={16} strokeWidth={2} /> : null}
      {label}
      {extra === undefined ? null : <small className="folder-chip-owner">{extra}</small>}
    </label>
  );
  return (
    <div className="field folder-field">
      <span className="field-label" id={labelId}>
        Folder
      </span>
      <div className="folder-picker" role="radiogroup" aria-labelledby={labelId}>
        <div className="folder-chips">{chip({ kind: "unsorted" }, UNSORTED, unsorted === null ? "new" : undefined)}</div>
        {groups.map((group) => {
          const folders = group.folders.filter((folder) => folder.id !== unsorted?.id);
          if (folders.length === 0) return null;
          return (
            <div key={group.key} className="folder-picker-group">
              <span className="folder-picker-title">{group.title}</span>
              <div className="folder-chips">{folders.map((folder) => chip({ kind: "folder", id: folder.id }, folder.name))}</div>
            </div>
          );
        })}
        <div className="folder-chips">{chip({ kind: "new" }, "New folder")}</div>
      </div>
      {value.kind === "new" ? (
        <input
          className="control"
          aria-label="New folder name"
          placeholder="Folder name"
          value={newName}
          maxLength={80}
          onChange={(event) => {
            onNewName(event.target.value);
          }}
        />
      ) : null}
      <span className="field-hint">Pick a folder now, or leave it in Unsorted and move it later.</span>
    </div>
  );
}
