import { useState } from "react";
import { ApiError, api } from "../api";
import { refreshCatalog, useCatalog, type SemesterGroup } from "../catalog";
import { Button } from "./Button";
import { TextField } from "./TextField";

type Run = (work: () => Promise<unknown>) => void;

/** One save at a time: Home's list is read again after it, and a refusal shows under the card. */
function useRun(): { busy: boolean; error: string | null; run: Run } {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run: Run = (work) => {
    setError(null);
    setBusy(true);
    void work()
      .then(() => refreshCatalog())
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : "Could not save that.");
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return { busy, error, run };
}

/**
 * Her Settings: each semester's name and dates, and archiving one she finished. Adding a semester,
 * course or topic is Home's +, and renaming, moving or archiving one is its card's menu on Home.
 */
export function SemestersEditor() {
  const catalog = useCatalog();
  const saved = catalog.status === "ready" ? catalog.semesters : [];
  const { busy, error, run } = useRun();

  return (
    <section className="group">
      <h2 className="group-header">Semesters</h2>
      {saved.length === 0 ? null : (
        <div className="stack">
          {saved.map((semester) => (
            <SemesterCard key={semester.id} semester={semester} busy={busy} onRun={run} />
          ))}
        </div>
      )}
      <p className="group-footer">
        Name a semester, give it dates, or archive one you finished. Add a semester, course or topic with the + on Home, and rename, move or
        archive a course or topic from its card there.
      </p>
      {catalog.status === "failed" ? <p className="form-error">{catalog.message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

function SemesterCard({
  semester,
  busy,
  onRun,
}: {
  semester: SemesterGroup;
  busy: boolean;
  onRun: (work: () => Promise<unknown>) => void;
}) {
  const [name, setName] = useState(semester.name);
  const [startsOn, setStartsOn] = useState(semester.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(semester.endsOn ?? "");

  return (
    <div className="group-card stack">
      <TextField label={`${semester.label} name`} value={name} onChange={setName} />
      <label className="field">
        <span className="field-label">Starts</span>
        <input
          className="control"
          type="date"
          aria-label={`${semester.label} starts`}
          value={startsOn}
          onChange={(event) => {
            setStartsOn(event.target.value);
          }}
        />
      </label>
      <label className="field">
        <span className="field-label">Ends</span>
        <input
          className="control"
          type="date"
          aria-label={`${semester.label} ends`}
          value={endsOn}
          onChange={(event) => {
            setEndsOn(event.target.value);
          }}
        />
      </label>
      <div className="row-actions">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            onRun(() =>
              api(`/api/semesters/${semester.id}`, {
                method: "PATCH",
                json: { name, startsOn: startsOn === "" ? null : startsOn, endsOn: endsOn === "" ? null : endsOn },
              }),
            );
          }}
        >
          Save {semester.label}
        </Button>
        {/* By hand only: nothing archives a semester when it ends. */}
        <Button
          variant="plain"
          disabled={busy}
          onClick={() => {
            onRun(() => api(`/api/semesters/${semester.id}`, { method: "PATCH", json: { archived: semester.archivedAt === null } }));
          }}
        >
          {semester.archivedAt === null ? `Archive ${semester.label}` : `Unarchive ${semester.label}`}
        </Button>
      </div>
    </div>
  );
}
