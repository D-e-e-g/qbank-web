import { useEffect, useState } from "react";
import { ApiError, api, type CourseTerm } from "../api";
import { EmptyState } from "../components/EmptyState";
import { folderLabel } from "../course/folders";
import { useCourseVersion } from "../course/deletion";
import { useCourse, useCourseNaming } from "../course/useCourse";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";

export function TermsScreen({ courseId }: { courseId: string }) {
  const [terms, setTerms] = useState<CourseTerm[] | null>(null);
  // Her folders, so a folder name two exam pages share says which page.
  const { course } = useCourse(courseId);
  const { words } = useCourseNaming(courseId, course);
  // A delete or an Undo changes which sets define terms.
  const version = useCourseVersion(courseId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void api<{ terms: CourseTerm[] }>(`/api/courses/${courseId}/terms`)
      .then((body) => {
        if (!cancel) setTerms(body.terms);
      })
      .catch((caught: unknown) => {
        if (!cancel) setError(caught instanceof ApiError ? caught.message : "Could not load terms.");
      });
    return () => {
      cancel = true;
    };
  }, [courseId, version]);

  return (
    <Screen title="Terms">
      <ShellLink to={`/course/${courseId}`} className="text-action" current={false}>
        {words.Container}
      </ShellLink>
      <p className="note">When a term is defined in more than one set, the newest set’s definition is the one shown here.</p>
      {error ? <p className="form-error">{error}</p> : null}
      {terms?.length === 0 ? (
        <div className="empty-card">
          <EmptyState icon="book-marked" message="Terms appear here after a file that defines them is imported." />
        </div>
      ) : null}
      {terms !== null && terms.length > 0 ? (
        <ul className="term-list">
          {terms.map((term) => (
            <li key={term.key} className="term-row">
              <div className="course-card-title">{term.term}</div>
              <p className="term-meaning">{term.meaning}</p>
              <div className="course-meta">
                {course ? folderLabel(course, term.folderId, term.folderName) : term.folderName} · {term.setTitle}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Screen>
  );
}
