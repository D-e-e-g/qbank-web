import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ApiError, api, type ExamView } from "../api";
import { refreshCatalog } from "../catalog";
import { Button } from "../components/Button";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { CountdownTimer } from "../components/CountdownTimer";
import { Icon } from "../components/Icon";
import { useFrozen } from "../frozen";
import { navigate } from "../router";
import { AnswerArea } from "../practice/Answers";
import { StemExhibits } from "../practice/Exhibits";
import {
  FORMAT_LABELS,
  initialDraft,
  makeLayout,
  readPracticeSet,
  toggleStrike,
  toResponse,
  type LoadedQuestion,
} from "../practice/model";
import { RunnerShell } from "../practice/RunnerShell";
import { isTransient, submitAttempt } from "../submit-attempt";
import { ExamResultView } from "./ExamResult";
import { foldersText } from "./names";
import { initialPhase, runnerReduce, type EndProblem, type ItemState, type RunnerPhase, type RunnerState } from "./runner";

/** An exam from the server with its questions read the way the runner reads a practice set. */
export interface LoadedExam {
  view: ExamView;
  questions: LoadedQuestion[];
}

export function ExamScreen({ courseId, examId, wide }: { courseId: string; examId: string; wide: boolean }) {
  const [exam, setExam] = useState<LoadedExam | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void api<ExamView>(`/api/exams/${examId}`)
      .then((view) => {
        if (cancel) return;
        const loaded = readExam(view);
        if (loaded?.view.courseId !== courseId) {
          setError(loaded ? "That exam is not in this course." : "This exam could not be read.");
          return;
        }
        setError(null);
        setExam(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancel) setError(caught instanceof ApiError ? caught.message : "Could not open that exam.");
      });
    return () => {
      cancel = true;
    };
  }, [courseId, examId]);

  useEffect(() => {
    if (exam) document.title = `Exam · ${foldersText(exam.view.weeks)} · Qbank`;
  }, [exam]);

  const ended = useCallback((view: ExamView) => {
    const loaded = readExam(view);
    if (loaded) setExam(loaded);
    void refreshCatalog();
  }, []);

  const close = () => {
    navigate(`/course/${courseId}/exam`);
  };

  if (!exam) {
    return (
      <RunnerShell wide={wide} title="Exam" count="" onClose={close}>
        <p className="note">{error ?? "Loading the exam."}</p>
      </RunnerShell>
    );
  }

  if (exam.view.result !== null) return <ExamResultView exam={exam} wide={wide} />;

  return <ExamRunner exam={exam} wide={wide} onEnded={ended} />;
}

function ExamRunner({ exam, wide, onEnded }: { exam: LoadedExam; wide: boolean; onEnded: (view: ExamView) => void }) {
  const { frozen, guard } = useFrozen();
  const view = exam.view;
  const [state, dispatch] = useReducer(runnerReduce, exam, openRunner);
  const { items, phase } = state;
  const [confirming, setConfirming] = useState(false);

  // Counted from the server's clock, so a device whose clock is off still ends on time.
  const msLeftAtLoad = Date.parse(view.endsAt) - Date.parse(view.serverNow);
  const [secondsLeft, setSecondsLeft] = useState(msLeftAtLoad / 1000);
  const deadline = useRef<number | null>(null);

  useEffect(() => {
    deadline.current ??= Date.now() + msLeftAtLoad;
    const tick = () => {
      const left = ((deadline.current ?? Date.now()) - Date.now()) / 1000;
      setSecondsLeft(left);
      // Only the user's own app ends an exam, on time too. The frozen view shows the clock at 0:00.
      if (!frozen) dispatch({ type: "tick", secondsLeft: left });
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [frozen, msLeftAtLoad]);

  // The answer on its way. Leaving the saving phase (the clock ran out, she ended the exam, or the
  // runner closed) stops its retries; a late reply then changes nothing.
  const savingIndex = phase.phase === "saving" ? phase.index : null;
  const savingItem = savingIndex === null ? undefined : items[savingIndex];
  useEffect(() => {
    const question = savingIndex === null ? undefined : exam.questions[savingIndex];
    const response = savingItem ? toResponse(savingItem.draft) : null;
    if (!question || !savingItem || !response) return;
    const controller = new AbortController();
    void submitAttempt(
      {
        clientAttemptId: savingItem.clientAttemptId,
        questionId: question.id,
        response,
        guessed: savingItem.guessed,
        shuffle: savingItem.layout,
        studySessionId: view.id,
      },
      {
        signal: controller.signal,
        onRetry: () => {
          dispatch({ type: "saveRetrying" });
        },
      },
    ).then(
      () => {
        dispatch({ type: "saved" });
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return;
        if (caught instanceof ApiError && isErrorCode(caught.body, "already_answered")) dispatch({ type: "saved" });
        else if (caught instanceof ApiError && isErrorCode(caught.body, "exam_finished")) dispatch({ type: "examClosed" });
        else dispatch({ type: "saveFailed", message: caught instanceof ApiError ? caught.message : "Could not save that answer." });
      },
    );
    return () => {
      controller.abort();
    };
  }, [exam.questions, savingIndex, savingItem, view.id]);

  // Asking the server to end the exam. Ending one that has already ended returns it as it ended.
  const ending = phase.phase === "ending" ? phase : null;
  useEffect(() => {
    if (ending === null || frozen) return;
    let live = true;
    void api<ExamView>(`/api/exams/${view.id}/finish`, { method: "POST", json: { reason: ending.reason } }).then(
      (ended) => {
        if (live) onEnded(ended);
      },
      (caught: unknown) => {
        if (!live) return;
        const problem: EndProblem = isTransient(caught)
          ? { kind: "offline" }
          : { kind: "refused", message: caught instanceof ApiError ? caught.message : "Could not end the exam." };
        dispatch({ type: "endFailed", problem });
      },
    );
    return () => {
      live = false;
    };
  }, [ending, frozen, onEnded, view.id]);

  // Asked to end and not confirmed: ask again after the backoff, or as soon as the device is back online.
  const pending = phase.phase === "endPending" ? phase : null;
  useEffect(() => {
    if (pending?.retryInMs == null || frozen) return;
    const retry = () => {
      dispatch({ type: "retryEnd" });
    };
    const timer = setTimeout(retry, pending.retryInMs);
    window.addEventListener("online", retry);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", retry);
    };
  }, [frozen, pending]);

  const total = exam.questions.length;
  if (total === 0) {
    return (
      <RunnerShell wide={wide} title="Exam" count="">
        <p className="note">This exam has no questions.</p>
      </RunnerShell>
    );
  }

  const submittedCount = items.filter((entry) => entry.submitted).length;
  const running = phase.phase === "answering" || phase.phase === "saving";
  const title = `Exam · ${foldersText(view.weeks)}`;
  const endButton = (
    <Button
      variant="plain"
      className="runner-end"
      onClick={guard(() => {
        setConfirming(true);
      })}
    >
      End exam
    </Button>
  );
  const timer = <CountdownTimer seconds={secondsLeft} compact={!wide} />;

  if (!running) {
    return (
      <RunnerShell
        wide={wide}
        title={title}
        count={`${String(submittedCount)} of ${String(total)} answered`}
        progress={submittedCount / total}
        trailing={timer}
        footer={
          <div className="exam-actions">
            <Button
              className="btn-lg"
              disabled={phase.phase === "ending"}
              onClick={guard(() => {
                dispatch({ type: "retryEnd" });
              })}
            >
              {phase.reason === "left" ? "End exam" : "Finish exam"}
            </Button>
          </div>
        }
      >
        <EndingNotice phase={phase} submittedCount={submittedCount} total={total} />
      </RunnerShell>
    );
  }

  const index = phase.index;
  const loaded = exam.questions[index];
  const item = items[index];
  if (!loaded || !item) return null;
  const unsubmitted = items.filter((entry) => !entry.submitted).length;
  const response = toResponse(item.draft);
  const lastPending = unsubmitted === 1 && !item.submitted;
  const saving = phase.phase === "saving";
  const skippedLeft = phase.returning ? unsubmitted : 0;
  const error = phase.phase === "answering" ? phase.error : null;

  return (
    <RunnerShell
      wide={wide}
      title={title}
      count={`${String(index + 1)} of ${String(total)}`}
      progress={submittedCount / total}
      leading={endButton}
      trailing={timer}
      footer={
        <div className="exam-actions">
          <Button
            variant="quiet"
            className="btn-lg exam-skip"
            disabled={saving}
            onClick={() => {
              dispatch({ type: "skip" });
            }}
          >
            Skip for now
          </Button>
          <Button
            className="btn-lg"
            disabled={response === null || saving}
            onClick={guard(() => {
              dispatch({ type: "submit" });
            })}
          >
            {lastPending ? "Finish exam" : "Submit and continue"}
          </Button>
        </div>
      }
    >
      {error ? <p className="form-error">{error}</p> : null}
      {phase.phase === "saving" && phase.retrying ? (
        <p className="status-banner" role="status">
          <Icon name="clock" size={16} />
          <span>No connection. Your answer is saved as soon as you are back online.</span>
        </p>
      ) : null}
      {skippedLeft > 0 ? (
        <div className="status-banner exam-notice" role="status">
          <Icon name="info" size={16} />
          <span className="exam-notice-copy">
            {skippedLeft} skipped {skippedLeft === 1 ? "question" : "questions"} left.
            {phase.wrappedTo === index ? " This is the first one." : ""}
          </span>
          <Button
            variant="plain"
            className="exam-finish"
            disabled={saving}
            onClick={guard(() => {
              dispatch({ type: "end", reason: "finished" });
            })}
          >
            Finish exam
          </Button>
        </div>
      ) : null}
      <p className="runner-meta">
        <span className="runner-format">{FORMAT_LABELS[loaded.question.type]}</span>
        {loaded.topic ? <span>{loaded.topic}</span> : null}
        {item.skipped ? <span className="exam-skipped">Skipped earlier</span> : null}
      </p>
      <p className="runner-stem">{loaded.stem}</p>
      <StemExhibits loaded={loaded} />
      <p className="runner-ask">{loaded.ask}</p>
      <AnswerArea
        loaded={loaded}
        layout={item.layout}
        draft={item.draft}
        struck={item.struck}
        revealed={false}
        onDraft={(draft) => {
          dispatch({ type: "edit", change: () => ({ draft }) });
        }}
        onStrike={(option) => {
          dispatch({ type: "edit", change: (entry) => toggleStrike(entry.draft, entry.struck, option) });
        }}
      />
      <label className="guess-row">
        <input
          type="checkbox"
          checked={item.guessed}
          disabled={saving}
          onChange={(event) => {
            const guessed = event.target.checked;
            dispatch({ type: "edit", change: () => ({ guessed }) });
          }}
        />
        <span>
          <span className="guess-label">I'm guessing</span>
          <span className="guess-detail">Flag for review</span>
        </span>
      </label>
      {confirming ? (
        <ConfirmSheet
          title="End the exam now?"
          message={`The ${String(submittedCount)} ${submittedCount === 1 ? "question" : "questions"} you answered will be scored. Skipped and unreached questions score 0 and stay out of Review.`}
          confirmLabel="End exam"
          confirmVariant="destructive"
          cancelLabel="Keep going"
          onConfirm={() => {
            setConfirming(false);
            dispatch({ type: "end", reason: "left" });
          }}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      ) : null}
    </RunnerShell>
  );
}

/**
 * What the runner shows once the exam was asked to end, in place of a question: how much is
 * answered, that it is ending, and why it has not ended yet. The footer's one button asks again.
 */
function EndingNotice({ phase, submittedCount, total }: { phase: Extract<RunnerPhase, { phase: "ending" | "endPending" }>; submittedCount: number; total: number }) {
  const problem = phase.problem;
  const doing = phase.reason === "left" ? "Ending the exam." : phase.reason === "timeout" ? "Time is up. Ending the exam." : "Finishing the exam.";
  return (
    <div className="exam-ending" aria-live="polite">
      <p className="runner-ask">{submittedCount === total ? "Every question is answered." : `${String(submittedCount)} of ${String(total)} questions answered.`}</p>
      {problem === null ? <p className="note">{doing}</p> : null}
      {problem?.kind === "offline" ? (
        <p className="status-banner" role="status">
          <Icon name="clock" size={16} />
          <span>No connection. The exam ends as soon as you are back online.</span>
        </p>
      ) : null}
      {problem?.kind === "refused" ? <p className="form-error">{problem.message}</p> : null}
    </div>
  );
}

/** The runner as the exam opens: questions answered on any device stay submitted. */
function openRunner(exam: LoadedExam): RunnerState {
  const answered = new Set(exam.view.answeredQuestionIds);
  const items = exam.questions.map((question): ItemState => {
    const layout = makeLayout(question.question);
    return {
      layout,
      draft: initialDraft(question.question, layout),
      struck: [],
      guessed: false,
      clientAttemptId: crypto.randomUUID(),
      submitted: answered.has(question.id),
      skipped: false,
    };
  });
  return { items, phase: initialPhase(items) };
}

function readExam(view: ExamView): LoadedExam | null {
  const set = readPracticeSet({ id: view.id, courseId: view.courseId, title: "Exam", weekLabel: "", questions: view.questions });
  if (!set) return null;
  return { view, questions: set.questions };
}

function isErrorCode(body: unknown, code: string): boolean {
  return typeof body === "object" && body !== null && "error" in body && body.error === code;
}
