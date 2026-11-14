import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type ExamSetup, type ExamSummary, type TwinJob, type TwinJobStep, type TwinSet } from "../api";
import { useCatalogCourse } from "../catalog";
import { Button } from "../components/Button";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { Icon } from "../components/Icon";
import { courseLine, courseName } from "../course/pages";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";
import { ReplaceExamSheet } from "./ReplaceExamSheet";
import { NOT_KNOWN, type RunningExam } from "./start";
import { openExam } from "./status";
import { isRunning, stepIcon, stepProgress, TWIN_POLL_MS, twinCountText, twinJobTitle } from "./twins";
import { useExamStart } from "./useExamStart";

/**
 * A twin job: QBank writing exam twins of the folders and pool she picked on Exam setup. It shows
 * what the job does, its three steps as they go, and once the twins are filed, starts the exam on them.
 */
export function TwinJobScreen({ courseId, jobId }: { courseId: string; jobId: string }) {
  const [job, setJob] = useState<TwinJob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The user's exam in progress, read once the twins are ready: starting the exam on them ends it.
  // Start waits until it is known, so a read that failed or has not returned never ends it unasked.
  const [running, setRunning] = useState<RunningExam>(NOT_KNOWN);
  const [runningError, setRunningError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const learnRunning = useCallback((exam: ExamSummary | null) => {
    setRunning({ known: true, exam });
  }, []);
  const examStart = useExamStart(learnRunning);
  const done = job?.status === "done";
  // Home's card says whether it is a course or a topic, which the job does not.
  const course = useCatalogCourse(courseId);

  useEffect(() => {
    // Once the job is read, after the shell's own title for the address.
    document.title = job && course ? `${courseName(course)} Exam twins · Qbank` : "Exam twins · Qbank";
  }, [job, course]);

  // Read again while it runs. A dropped connection is tried again; a refusal is not.
  useEffect(() => {
    let cancel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      void api<TwinJob>(`/api/twin-jobs/${jobId}`)
        .then((body) => {
          if (cancel) return;
          setLoadError(null);
          setJob(body);
          if (isRunning(body)) timer = setTimeout(read, TWIN_POLL_MS);
        })
        .catch((caught: unknown) => {
          if (cancel) return;
          setLoadError(caught instanceof ApiError ? caught.message : "Could not load the exam twins. Trying again.");
          if (!(caught instanceof ApiError && caught.status < 500)) timer = setTimeout(read, TWIN_POLL_MS);
        });
    };
    read();
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  // Read like the job: a dropped connection is tried again; a refusal is not.
  useEffect(() => {
    if (!done) return;
    let cancel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      void api<ExamSetup>(`/api/courses/${courseId}/exams`)
        .then((setup) => {
          if (cancel) return;
          setRunningError(null);
          setRunning({ known: true, exam: openExam(setup.inProgress, Date.now()) });
        })
        .catch((caught: unknown) => {
          if (cancel) return;
          setRunningError(caught instanceof ApiError ? caught.message : "Could not check for an exam in progress. Trying again.");
          if (!(caught instanceof ApiError && caught.status < 500)) timer = setTimeout(read, TWIN_POLL_MS);
        });
    };
    read();
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [courseId, done]);

  const stop = () => {
    setConfirmStop(false);
    setStopping(true);
    setActionError(null);
    void api<TwinJob>(`/api/twin-jobs/${jobId}/cancel`, { method: "POST" })
      .then(setJob)
      .catch((caught: unknown) => {
        setActionError(caught instanceof ApiError ? caught.message : "Could not stop the exam twins.");
      })
      .finally(() => {
        setStopping(false);
      });
  };

  const start = () => {
    if (job?.exam == null) return;
    setActionError(null);
    // The job's exam goes as it is: the folders the twins are in, and the pool the user picked.
    examStart.start(job.course.id, job.exam, running);
  };

  const keepGoing = useCallback(() => {
    setConfirmStop(false);
  }, []);

  return (
    <Screen title="Exam twins">
      <ShellLink to={`/course/${courseId}/exam`} className="text-action" current={false}>
        Exam
      </ShellLink>
      {course ? <p className="note">{courseLine(course)}</p> : null}
      {loadError ? <p className="form-error">{loadError}</p> : null}
      {job === null && loadError === null ? <p className="note">Loading the exam twins.</p> : null}
      {job ? (
        <div className="exam-summary" aria-live="polite">
          <p className="exam-summary-head">
            <span className="exam-summary-count">{twinCountText(job)}</span>
            <span className="exam-summary-time">
              {twinJobTitle(job)}
              {job.pool === "wrong" ? " · Wrong questions only" : ""}
            </span>
          </p>
          <p className="exam-summary-note">{job.note}</p>
          {job.failure ? <p className="form-error">{job.failure}</p> : null}
          {job.status === "cancelled" && !job.failure ? <p className="exam-summary-note">Stopped. Your questions stay as they are.</p> : null}
          {actionError ? <p className="form-error">{actionError}</p> : null}
          {examStart.error ? <p className="form-error">{examStart.error}</p> : null}
          {done && runningError ? <p className="form-error">{runningError}</p> : null}
          {done ? (
            <Button
              fullWidth
              className="btn-lg"
              disabled={examStart.starting || job.exam === null || !running.known}
              onClick={start}
            >
              Start exam on the twins
            </Button>
          ) : null}
          {isRunning(job) ? (
            <Button
              variant="secondary"
              fullWidth
              className="btn-lg"
              disabled={stopping}
              onClick={() => {
                setConfirmStop(true);
              }}
            >
              Stop
            </Button>
          ) : null}
        </div>
      ) : null}
      {job ? <Steps steps={job.steps} /> : null}
      {/* Warnings show even when nothing was filed: every twin can be left out once its question has one. */}
      {job && (job.sets.length > 0 || job.warnings.length > 0) ? <FiledSets sets={job.sets} warnings={job.warnings} /> : null}
      {confirmStop ? (
        <ConfirmSheet
          title="Stop the exam twins?"
          message="QBank stops writing them. Your questions, sets and folders stay as they are."
          confirmLabel="Stop"
          confirmVariant="destructive"
          cancelLabel="Keep going"
          onConfirm={stop}
          onCancel={keepGoing}
        />
      ) : null}
      {examStart.asking ? <ReplaceExamSheet onConfirm={examStart.confirm} onCancel={examStart.dismiss} /> : null}
    </Screen>
  );
}

/** Read your questions, Exam twins, File the twins: each with its mark and how far it is. */
function Steps({ steps }: { steps: readonly TwinJobStep[] }) {
  return (
    <section className="group">
      <h2 className="group-header">Steps</h2>
      <ul className="review-list" aria-label="Steps">
        {steps.map((step) => (
          <li key={step.key}>
            <div className={`review-row twin-step twin-step-${step.state}`}>
              <span className="row-icon">
                <Icon name={stepIcon(step)} size={20} />
              </span>
              <span className="review-copy">
                <span className="review-topic">{step.label}</span>
              </span>
              <span className={step.state === "done" ? "folder-state folder-state-done" : "folder-state"}>{stepProgress(step)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The exam sets filed so far, each in the folder of the practice set it twins, and the job's warnings: her checker's, and twins left out at filing. */
function FiledSets({ sets, warnings }: { sets: readonly TwinSet[]; warnings: readonly string[] }) {
  return (
    <section className="group">
      <h2 className="group-header">Filed</h2>
      {sets.length === 0 ? (
        <p className="note">Nothing was filed.</p>
      ) : (
        <ul className="review-list" aria-label="Filed">
          {sets.map((set) => (
            <li key={set.setId}>
              <div className="review-row">
                <span className="review-copy">
                  <span className="review-topic">{set.title}</span>
                  <span className="review-meta">
                    {set.folderName} · {set.questionCount} {set.questionCount === 1 ? "question" : "questions"} · Twins of {set.twinsOf.title}
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="group-footer">
          {warning}
        </p>
      ))}
    </section>
  );
}
