import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type ExamEndReason, type ExamView } from "../api";
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
  type Draft,
  type Layout,
  type LoadedQuestion,
} from "../practice/model";
import { RunnerShell } from "../practice/RunnerShell";
import { submitAttempt } from "../submit-attempt";
import { ExamResultView } from "./ExamResult";
import { foldersText } from "./names";

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

interface ItemState {
  layout: Layout;
  draft: Draft;
  /** Choices she has struck out, as original option indexes. Kept for this sitting only, never sent. */
  struck: readonly number[];
  guessed: boolean;
  clientAttemptId: string;
  submitted: boolean;
  skipped: boolean;
}

/** Where to go after a question: the next one not yet submitted, wrapping back to skipped ones. */
function nextStop(items: readonly ItemState[], from: number): { index: number; wrapped: boolean } | null {
  for (let index = from + 1; index < items.length; index += 1) {
    if (!items[index]?.submitted) return { index, wrapped: false };
  }
  for (let index = 0; index <= from && index < items.length; index += 1) {
    if (!items[index]?.submitted) return { index, wrapped: true };
  }
  return null;
}

function ExamRunner({ exam, wide, onEnded }: { exam: LoadedExam; wide: boolean; onEnded: (view: ExamView) => void }) {
  const { frozen, guard } = useFrozen();
  const view = exam.view;
  const [items, setItems] = useState<ItemState[]>(() => {
    const answered = new Set(view.answeredQuestionIds);
    return exam.questions.map((question) => {
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
  });
  const [index, setIndex] = useState(() => {
    const first = nextStop(items, -1);
    return first?.index ?? 0;
  });
  // Every question has been reached once: she is working back through the skipped ones.
  const [returning, setReturning] = useState(false);
  const [wrappedTo, setWrappedTo] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Counted from the server's clock, so a device whose clock is off still ends on time.
  const msLeftAtLoad = Date.parse(view.endsAt) - Date.parse(view.serverNow);
  const [secondsLeft, setSecondsLeft] = useState(msLeftAtLoad / 1000);
  const deadline = useRef<number | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const endingRef = useRef(false);

  const end = useCallback(
    (reason: ExamEndReason) => {
      // Only the user's own app ends an exam, on time too. The frozen view shows the clock at 0:00.
      if (endingRef.current || frozen) return;
      endingRef.current = true;
      inFlight.current?.abort();
      setConfirming(false);
      setEnding(true);
      setError(null);
      void api<ExamView>(`/api/exams/${view.id}/finish`, { method: "POST", json: { reason } })
        .then(onEnded)
        .catch((caught: unknown) => {
          endingRef.current = false;
          setEnding(false);
          setError(caught instanceof ApiError ? caught.message : "Could not end the exam. Check the connection and try again.");
        });
    },
    [frozen, onEnded, view.id],
  );

  useEffect(() => {
    deadline.current ??= Date.now() + msLeftAtLoad;
    const tick = () => {
      const left = ((deadline.current ?? Date.now()) - Date.now()) / 1000;
      setSecondsLeft(left);
      if (left <= 0) end("timeout");
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [end, msLeftAtLoad]);

  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    [],
  );

  const loaded = exam.questions[index];
  const item = items[index];
  if (!loaded || !item) {
    return (
      <RunnerShell wide={wide} title="Exam" count="">
        <p className="note">This exam has no questions.</p>
      </RunnerShell>
    );
  }

  const total = exam.questions.length;
  const submittedCount = items.filter((entry) => entry.submitted).length;
  const pending = items.filter((entry) => !entry.submitted).length;
  const response = toResponse(item.draft);
  const lastPending = pending === 1 && !item.submitted;
  const busy = saving || ending;

  const go = (from: number, next: ItemState[]) => {
    const stop = nextStop(next, from);
    if (stop === null) {
      end("finished");
      return;
    }
    if (stop.wrapped) setReturning(true);
    setWrappedTo(stop.wrapped ? stop.index : null);
    setIndex(stop.index);
  };

  const submit = () => {
    if (busy || !response) return;
    setError(null);
    setSaving(true);
    const controller = new AbortController();
    inFlight.current = controller;
    const at = index;
    void submitAttempt(
      {
        clientAttemptId: item.clientAttemptId,
        questionId: loaded.id,
        response,
        guessed: item.guessed,
        shuffle: item.layout,
        studySessionId: view.id,
      },
      {
        signal: controller.signal,
        onRetry: () => {
          setWaiting(true);
        },
      },
    ).then(
      () => {
        setSaving(false);
        setWaiting(false);
        const next = items.map((entry, position) => (position === at ? { ...entry, submitted: true, skipped: false } : entry));
        setItems(next);
        go(at, next);
      },
      (caught: unknown) => {
        setSaving(false);
        setWaiting(false);
        if (controller.signal.aborted) return;
        if (caught instanceof ApiError && isErrorCode(caught.body, "already_answered")) {
          const next = items.map((entry, position) => (position === at ? { ...entry, submitted: true, skipped: false } : entry));
          setItems(next);
          go(at, next);
          return;
        }
        if (caught instanceof ApiError && isErrorCode(caught.body, "exam_finished")) {
          void api<ExamView>(`/api/exams/${view.id}`).then(onEnded, () => {
            setError(caught.message);
          });
          return;
        }
        setError(caught instanceof ApiError ? caught.message : "Could not save that answer.");
      },
    );
  };

  const skip = () => {
    if (busy) return;
    setError(null);
    const next = items.map((entry, position) => (position === index ? { ...entry, skipped: true } : entry));
    setItems(next);
    go(index, next);
  };

  const skippedLeft = returning ? pending : 0;

  return (
    <RunnerShell
      wide={wide}
      title={`Exam · ${foldersText(view.weeks)}`}
      count={`${String(index + 1)} of ${String(total)}`}
      progress={submittedCount / total}
      leading={
        <Button
          variant="plain"
          className="runner-end"
          disabled={ending}
          onClick={guard(() => {
            setConfirming(true);
          })}
        >
          End exam
        </Button>
      }
      trailing={<CountdownTimer seconds={secondsLeft} compact={!wide} />}
      footer={
        <div className="exam-actions">
          <Button variant="quiet" className="btn-lg exam-skip" disabled={busy} onClick={skip}>
            Skip for now
          </Button>
          <Button className="btn-lg" disabled={response === null || busy} onClick={() => { guard(submit)(); }}>
            {lastPending ? "Finish exam" : "Submit and continue"}
          </Button>
        </div>
      }
    >
      {error ? <p className="form-error">{error}</p> : null}
      {waiting ? (
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
            {wrappedTo === index ? " This is the first one." : ""}
          </span>
          <Button variant="plain" className="exam-finish" disabled={busy} onClick={() => { guard(end)("finished"); }}>
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
          if (busy) return;
          setItems((current) => current.map((entry, position) => (position === index ? { ...entry, draft } : entry)));
        }}
        onStrike={(option) => {
          if (busy) return;
          setItems((current) =>
            current.map((entry, position) => (position === index ? { ...entry, ...toggleStrike(entry.draft, entry.struck, option) } : entry)),
          );
        }}
      />
      <label className="guess-row">
        <input
          type="checkbox"
          checked={item.guessed}
          disabled={busy}
          onChange={(event) => {
            const guessed = event.target.checked;
            setItems((current) => current.map((entry, position) => (position === index ? { ...entry, guessed } : entry)));
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
            end("left");
          }}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      ) : null}
    </RunnerShell>
  );
}

function readExam(view: ExamView): LoadedExam | null {
  const set = readPracticeSet({ id: view.id, courseId: view.courseId, title: "Exam", weekLabel: "", questions: view.questions });
  if (!set) return null;
  return { view, questions: set.questions };
}

function isErrorCode(body: unknown, code: string): boolean {
  return typeof body === "object" && body !== null && "error" in body && body.error === code;
}
