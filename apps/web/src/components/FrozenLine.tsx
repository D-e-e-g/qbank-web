import { ShellLink } from "../shell/ShellLink";
import { useStudents, viewedStudent } from "../students";
import { Icon } from "./Icon";

/**
 * Whose account is on screen, in a band of its own above the app, so the screens under it lay out
 * as the user's do. Accounts goes back to the Admin page, also out of an exam, which has no way back of its own.
 */
export function FrozenLine() {
  const student = viewedStudent(useStudents(true));
  return (
    <p className="frozen-line">
      <Icon name="eye" size={14} />
      <span className="frozen-line-who">{student === null ? "Frozen view" : `Viewing ${student.email}`}</span>
      <ShellLink to="/admin" className="frozen-line-link" current={false}>
        Accounts
      </ShellLink>
    </p>
  );
}
