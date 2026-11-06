import { useState } from "react";
import { ApiError } from "../api";
import { StudentPassword } from "../login/AccountPanels";
import { navigate } from "../router";
import { pickStudent, useStudents, viewedStudent, type Student } from "../students";
import { when } from "../when";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { RowBody } from "./NavRow";

/** The user accounts the admin may view, each opening its frozen Home, and the temporary password of the one being viewed. */
export function StudentsSection() {
  const list = useStudents(true);
  const student = viewedStudent(list);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (id: string) => {
    if (id === list?.viewingId) {
      navigate("/");
      return;
    }
    setError(null);
    setBusy(true);
    void pickStudent(id)
      .then(() => {
        navigate("/");
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : "Could not open that user account.");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className="group">
      <h2 className="group-header">User accounts</h2>
      {list === null ? null : student === null ? (
        <div className="empty-card">
          <EmptyState icon="user" message="No user account yet. Add an email to the sign-up list, and that person can sign up." />
        </div>
      ) : (
        <>
          <ul className="list-group" aria-label="User accounts">
            {list.students.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="list-row"
                  disabled={busy}
                  onClick={() => {
                    open(item.id);
                  }}
                >
                  <RowBody icon="user" title={item.email} strong tag={item.id === list.viewingId ? "Viewing" : null} meta={accountLine(item)} />
                  <span className="list-chevron">
                    <Icon name="chevron-right" size={18} strokeWidth={2} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {error ? <p className="form-error">{error}</p> : null}
          <p className="group-footer">Open one to see it as its user does, frozen: nothing in it can be changed. The temporary password and Repair use the one marked Viewing.</p>
          <div className="group-card stack">
            <StudentPassword key={student.id} email={student.email} />
          </div>
        </>
      )}
    </section>
  );
}

/** "Sam · Created Oct 12", or the date alone for an account with no name. */
function accountLine(student: Student): string {
  const created = `Created ${when(student.createdAt)}`;
  return student.name === "" ? created : `${student.name} · ${created}`;
}
