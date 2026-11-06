import { useState } from "react";
import { ApiError, api, type RepairPlan } from "../api";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { Icon } from "../components/Icon";
import { SignUpList } from "../components/SignUpList";
import { StudentsSection } from "../components/StudentsSection";
import { useSession } from "../login/session-context";
import { Screen } from "../shell/Screen";
import { useStudents, viewedStudent } from "../students";
import { NotFoundScreen } from "./NotFoundScreen";

/** The admin's home control page: the user accounts it may view, and its tools for them. Nobody else has this screen. */
export function AdminScreen() {
  const session = useSession();
  if (session.user.role !== "admin") return <NotFoundScreen />;
  return (
    <Screen title="Admin">
      <StudentsSection />
      <SignUpList />
      <RepairPanel />
    </Screen>
  );
}

function RepairPanel() {
  const student = viewedStudent(useStudents(true));
  const [plan, setPlan] = useState<RepairPlan | null>(null);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = () => {
    setError(null);
    setBusy(true);
    void api<RepairPlan>("/api/admin/repair")
      .then((next) => {
        setPlan(next);
        setAsking(true);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : "Could not preview the repair.");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className="group">
      <h2 className="group-header">Repair</h2>
      <p className="group-footer">For when something breaks, not for normal use. Each repair says what it will change and asks first.</p>
      <div className="review-list">
        <button type="button" className="review-row" disabled={busy} onClick={ask}>
          <span className="row-icon">
            <Icon name="wrench" size={20} />
          </span>
          <span className="review-copy">
            <span className="review-topic">Rebuild progress and Review</span>
            <span className="review-meta">{done ?? (student === null ? "From her saved answers" : `From ${student.email}'s saved answers`)}</span>
          </span>
          <span className="review-chevron">
            <Icon name="chevron-right" size={18} />
          </span>
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {asking && plan !== null ? (
        <ConfirmSheet
          title="Rebuild her progress and Review?"
          message={plan.summary}
          confirmLabel="Rebuild"
          onConfirm={() => {
            setAsking(false);
            setBusy(true);
            void api<RepairPlan>("/api/admin/repair", { method: "POST", json: { confirmed: true } })
              .then((result) => {
                setPlan(result);
                const answers = result.attemptCount === 1 ? "answer" : "answers";
                setDone(`Rebuilt just now from ${String(result.attemptCount)} saved ${answers}`);
              })
              .catch((caught: unknown) => {
                setError(caught instanceof ApiError ? caught.message : "Could not rebuild her progress.");
              })
              .finally(() => {
                setBusy(false);
              });
          }}
          onCancel={() => {
            setAsking(false);
          }}
        />
      ) : null}
    </section>
  );
}
