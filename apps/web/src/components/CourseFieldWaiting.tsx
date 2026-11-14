import { refreshCatalog, type Catalog } from "../catalog";
import { Button } from "./Button";

/**
 * The Course field of Import and Make questions while there is no course to pick yet: the sentence
 * of a load that failed, with Try again, or that the courses are loading. It stands in for the
 * menu, so a course that is not known yet is never offered as a new one.
 */
export function CourseFieldWaiting({ catalog }: { catalog: Catalog }) {
  return (
    <div className="field">
      <span className="field-label">Course</span>
      {catalog.status === "failed" ? (
        <>
          <p className="form-error">{catalog.message}</p>
          <Button
            variant="secondary"
            className="field-action"
            onClick={() => {
              void refreshCatalog();
            }}
          >
            Try again
          </Button>
        </>
      ) : (
        <p className="note">Loading your courses</p>
      )}
    </div>
  );
}
