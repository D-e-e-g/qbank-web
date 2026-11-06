import { useCallback, useState, type ReactNode } from "react";
import type { ExamSummary } from "../api";
import { DeleteSheet } from "../components/DeleteSheet";
import { useFrozen } from "../frozen";
import { PastExamRow } from "./PastExamRow";

/**
 * Her ended exams, newest first, each opening its result. Edit puts Delete on each row; a deleted
 * exam stops counting toward her progress, and Undo brings it back. `empty` shows when there is none.
 */
export function PastExamList({
  courseId,
  exams,
  title,
  empty,
}: {
  courseId: string;
  exams: readonly ExamSummary[];
  title: string;
  empty: ReactNode;
}) {
  const { guard } = useFrozen();
  const [edit, setEdit] = useState(false);
  const [doomed, setDoomed] = useState<string | null>(null);
  const editing = edit && exams.length > 0;
  const close = useCallback(() => {
    setDoomed(null);
  }, []);
  // Deleting the last exam ends Edit, so Undo brings its row back as a row that opens it.
  const deleted = () => {
    setDoomed(null);
    if (exams.length <= 1) setEdit(false);
  };

  return (
    <section className="group">
      <div className="group-head">
        <h2 className="group-header">{title}</h2>
        {exams.length === 0 ? null : (
          <button
            type="button"
            className="group-action"
            aria-label={editing ? `Done editing ${title.toLowerCase()}` : `Edit ${title.toLowerCase()}`}
            onClick={guard(() => {
              setEdit(!editing);
            })}
          >
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      {exams.length === 0 ? (
        empty
      ) : (
        <ul className="review-list" aria-label={title}>
          {exams.map((exam) => (
            <li key={exam.id}>
              <PastExamRow
                courseId={courseId}
                exam={exam}
                onDelete={
                  editing
                    ? () => {
                        setDoomed(exam.id);
                      }
                    : null
                }
              />
            </li>
          ))}
        </ul>
      )}
      {doomed !== null ? <DeleteSheet courseId={courseId} items={[{ kind: "exam", id: doomed }]} title="Delete this exam?" onDeleted={deleted} onClose={close} /> : null}
    </section>
  );
}
