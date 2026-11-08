import { useEffect, useRef, useState } from "react";
import { ApiError, api, type CourseDetail } from "../api";
import { Button } from "../components/Button";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { Icon, type IconName } from "../components/Icon";
import { useFrozen } from "../frozen";
import { navigate } from "../router";
import { practiceSetIsFinished } from "../screens/set-status";
import { AnswerArea } from "./Answers";
import { RationaleImages, StemExhibits } from "./Exhibits";
import { FORMAT_LABELS, readPracticeSet, toResponse } from "./model";
import { NewRunNotice } from "./NewRunNotice";
import type { PracticeSource } from "./source";
import { recordPracticeAnswer, type Feedback } from "./recordPracticeAnswer";
import { RunnerShell } from "./RunnerShell";
import { advance, answeredCount, beginSession, nextIndex, pickedUpLine, reveal, startOver, startOverMessage, strike, updateAttempt, type Session } from "./session";

export function PracticeScreen({ courseId, source, wide }: { courseId: string; source: PracticeSource; wide: boolean }) {
  const { guard } = useFrozen();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [askingStartOver, setAskingStartOver] = useState(false);

  useEffect(() => {
    let cancel = false;
    // The course row says whether the set is already finished. Read it with the set so the notice
    // is in the first paint, rather than shifting the question down when it arrives.
    const detail: Promise<CourseDetail | null> =
      source.kind === "set"
        ? api<CourseDetail>(`/api/courses/${courseId}`).then(
            (course) => course,
            () => null,
          )
        : Promise.resolve(null);
    void Promise.all([api<unknown>(source.loadPath), detail])
      .then(([body, course]) => {
        if (cancel) return;
        if (typeof body === "object" && body !== null && "kind" in body && body.kind === "exam") {
          setError("This set’s questions are asked only on exams.");
          return;
        }
        const loaded = readPracticeSet(body);
        if (loaded?.courseId !== courseId) {
          setError(loaded ? "That set is not in this course." : "This set could not be read.");
          return;
        }
        setError(null);
        setSession(beginSession(loaded, source.kind, practiceSetIsFinished(course, loaded.id)));
      })
      .catch((caught: unknown) => {
        if (!cancel) setError(caught instanceof ApiError ? caught.message : "Could not open that set.");
      });
    return () => {
      cancel = true;
    };
  }, [courseId, source]);

  useEffect(() => {
    if (session) document.title = `${session.title} · Qbank`;
  }, [session]);

  const feedbackRef = useRef<HTMLDivElement>(null);
  const revealedKey = session?.attempts[session.index]?.score ? String(session.index) : "";
  useEffect(() => {
    if (revealedKey === "") return;
    feedbackRef.current?.scrollIntoView({ block: "nearest" });
  }, [revealedKey]);

  const close = () => {
    navigate(source.closeTo);
  };

  if (!session) {
    return (
      <RunnerShell wide={wide} title="Practice" count="" onClose={close}>
        <p className="note">{error ?? (source.kind === "review" ? "Loading Review." : "Loading the set.")}</p>
      </RunnerShell>
    );
  }

  if (session.finishedAt !== null) {
    return <Results session={session} wide={wide} closeLabel={source.closeLabel} onClose={close} />;
  }

  const loaded = session.questions[session.index];
  const attempt = session.attempts[session.index];
  if (!loaded || !attempt) {
    return (
      <RunnerShell wide={wide} title={session.title} count="" onClose={close}>
        <p className="note">{session.kind === "review" ? "Nothing to review here right now." : "This set has no questions."}</p>
      </RunnerShell>
    );
  }

  const revealed = attempt.score !== null;
  const response = toResponse(attempt.draft);
  const points = attempt.score?.pointsText ?? null;
  const rule = attempt.score?.ruleText ?? null;
  const last = nextIndex(session) === -1;

  const check = () => {
    if (checking || attempt.score || !response) return;
    setError(null);
    setChecking(true);
    void recordPracticeAnswer(
      {
        clientAttemptId: attempt.clientAttemptId,
        questionId: loaded.id,
        response,
        guessed: attempt.guessed,
        layout: attempt.layout,
        fromReview: session.kind === "review",
      },
      () => {
        setWaiting(true);
      },
    ).then(
      (score) => {
        setChecking(false);
        setWaiting(false);
        setSession((current) => reveal(current, session.index, attempt.guessed, score));
      },
      (caught: unknown) => {
        setChecking(false);
        setWaiting(false);
        setError(caught instanceof ApiError ? caught.message : "Could not save that answer.");
      },
    );
  };

  const confirmStartOver = () => {
    setAskingStartOver(false);
    setError(null);
    setChecking(true);
    void api(`${source.loadPath}/start-over`, { method: "POST" }).then(
      () => {
        setChecking(false);
        setSession(startOver);
      },
      (caught: unknown) => {
        setChecking(false);
        setError(caught instanceof ApiError ? caught.message : "Could not start over. Check your connection and try again.");
      },
    );
  };

  return (
    <RunnerShell
      wide={wide}
      title={session.title}
      count={`${String(session.index + 1)} of ${String(session.questions.length)}`}
      progress={answeredCount(session) / session.questions.length}
      onClose={close}
      footer={
        revealed ? (
          <Button
            fullWidth
            onClick={() => {
              setSession((current) => advance(current));
            }}
          >
            {last ? "See results" : "Next question"}
          </Button>
        ) : (
          <Button fullWidth disabled={response === null || checking} onClick={guard(check)}>
            Check answer
          </Button>
        )
      }
    >
      {session.pickedUp ? (
        <div className="runner-pickup">
          <span>{pickedUpLine(session.pickedUp)}</span>
          <button
            type="button"
            className="runner-pickup-action"
            disabled={checking}
            onClick={guard(() => {
              setAskingStartOver(true);
            })}
          >
            Start over
          </button>
        </div>
      ) : null}
      <NewRunNotice session={session} />
      {error ? <p className="form-error">{error}</p> : null}
      {waiting ? (
        <p className="status-banner" role="status">
          <Icon name="clock" size={16} />
          <span>No connection. Your answer is saved as soon as you are back online.</span>
        </p>
      ) : null}
      <p className="runner-meta">
        <span className="runner-format">{FORMAT_LABELS[loaded.question.type]}</span>
        {loaded.topic ? <span>{loaded.topic}</span> : null}
      </p>
      <p className="runner-stem">{loaded.stem}</p>
      <StemExhibits loaded={loaded} />
      <p className="runner-ask">{loaded.ask}</p>
      {attempt.score ? (
        <div className={`feedback feedback-${attempt.score.status}`} role="status" ref={feedbackRef}>
          <p className="feedback-label">
            <Icon name={statusIcon(attempt.score.status)} />
            {attempt.score.label}
          </p>
          {points ? <p className="feedback-detail">{points}</p> : null}
          {rule ? <p className="feedback-detail">{rule}</p> : null}
          {attempt.guessed ? <p className="feedback-detail">Flagged as a guess</p> : null}
        </div>
      ) : null}
      <AnswerArea
        loaded={loaded}
        layout={attempt.layout}
        draft={attempt.draft}
        struck={attempt.struck}
        revealed={revealed}
        onDraft={(draft) => {
          if (revealed) return;
          setSession((current) => updateAttempt(current, session.index, (item) => ({ ...item, draft })));
        }}
        onStrike={
          revealed
            ? undefined
            : (option) => {
                setSession((current) => strike(current, session.index, option));
              }
        }
      />
      {revealed ? null : (
        <label className="guess-row">
          <input
            type="checkbox"
            checked={attempt.guessed}
            disabled={checking}
            onChange={(event) => {
              const guessed = event.target.checked;
              setSession((current) => updateAttempt(current, session.index, (item) => ({ ...item, guessed })));
            }}
          />
          <span>
            <span className="guess-label">I'm guessing</span>
            <span className="guess-detail">Flag for review</span>
          </span>
        </label>
      )}
      {revealed ? (
        <div className="runner-feedback">
          <section>
            <h2 className="runner-kicker">Rationale</h2>
            <p className="runner-prose">{loaded.rationale}</p>
            <RationaleImages loaded={loaded} />
          </section>
          <section className="takeaway">
            <h2 className="runner-kicker">Key takeaway</h2>
            <p className="runner-prose">{loaded.takeaway}</p>
          </section>
          {loaded.terms.length > 0 ? (
            <section>
              <h2 className="runner-kicker">Terms in this question</h2>
              {loaded.terms.map((term) => (
                <div key={term.key} className="runner-term">
                  <div className="runner-term-name">{term.term}</div>
                  <p className="runner-term-meaning">{term.meaning}</p>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}
      {askingStartOver ? (
        <ConfirmSheet
          title={`Start over ${session.title}?`}
          message={startOverMessage(answeredCount(session))}
          confirmLabel="Start over"
          confirmVariant="destructive"
          onConfirm={confirmStartOver}
          onCancel={() => {
            setAskingStartOver(false);
          }}
        />
      ) : null}
    </RunnerShell>
  );
}

function Results({ session, wide, closeLabel, onClose }: { session: Session; wide: boolean; closeLabel: string; onClose: () => void }) {
  const fullyRight = session.attempts.filter((attempt) => attempt.score?.status === "correct").length;
  const partial = session.attempts.filter((attempt) => attempt.score?.status === "partial").length;
  const missed = session.attempts.filter((attempt) => attempt.score?.status === "incorrect").length;
  const guessed = session.attempts.filter((attempt) => attempt.guessed && attempt.score).length;
  let points = 0;
  let maxPoints = 0;
  for (const attempt of session.attempts) {
    if (!attempt.score) continue;
    points += attempt.score.points;
    maxPoints += attempt.score.maxPoints;
  }
  const elapsed = (session.finishedAt ?? session.startedAt) - session.startedAt;

  return (
    <div className={wide ? "runner runner-wide runner-results" : "runner runner-results"}>
      <div className="runner-scroll">
        <div className="runner-column result-column">
          <div className="result-head">
            <div className="result-done">
              <Button variant="plain" onClick={onClose}>
                Done
              </Button>
            </div>
            <p className="runner-kicker">
              {session.kind === "review" ? "Review finished" : "Set finished"} · {session.title}
            </p>
            <h1 className="result-title">
              {fullyRight} of {session.questions.length} fully right
            </h1>
            <p className="result-sub">
              {/* The clock of one opening says nothing about a sitting that took several. */}
              {points} of {maxPoints} points{session.pickedUp ? "" : ` · ${durationText(elapsed)}`}
            </p>
          </div>
          <ul className="result-stats" aria-label="Score summary">
            <li>
              <strong>{partial}</strong>
              Partly right
            </li>
            <li>
              <strong>{missed}</strong>
              Missed
            </li>
            <li>
              <strong>{guessed}</strong>
              Guessed
            </li>
          </ul>
          <section className="result-section">
            <h2 className="result-heading">By clinical judgment step</h2>
            <ul className="judgment" aria-label="By clinical judgment step">
              {judgmentRows(session).map((row) => (
                <li key={row.label}>
                  <span>{row.label}</span>
                  <span className="judgment-count">
                    {row.right} of {row.total}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="result-section">
            <h2 className="result-heading">Questions</h2>
            <div className="result-list">
              {session.questions.map((question, index) => {
                const attempt = session.attempts[index];
                const score = attempt?.score;
                return (
                  <details key={question.id} className="result-question">
                    <summary>
                      <span className="order-pos">{index + 1}</span>
                      <span className="result-question-copy">
                        <span className="choice-text">{question.topic || question.publicId}</span>
                        <span className="course-meta">
                          {FORMAT_LABELS[question.question.type]}
                          {score ? ` · ${String(score.points)} of ${String(score.maxPoints)}` : ""}
                        </span>
                      </span>
                      <span className={score ? `result-mark result-mark-${score.status}` : "result-mark"}>
                        {score ? markText(score, attempt.guessed) : "Not answered"}
                      </span>
                    </summary>
                    <div className="result-detail">
                      <p className="runner-prose">{question.stem}</p>
                      <StemExhibits loaded={question} />
                      <p className="runner-prose">
                        <strong>{question.ask}</strong>
                      </p>
                      <p className="runner-prose">{question.rationale}</p>
                      <RationaleImages loaded={question} />
                      <p className="takeaway runner-prose">{question.takeaway}</p>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
          <Button fullWidth onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function judgmentRows(session: Session): { label: string; right: number; total: number }[] {
  const groups = new Map<string, { right: number; total: number }>();
  session.questions.forEach((question, index) => {
    const label = question.cj && question.cj.length > 0 ? question.cj : "Not labeled";
    const group = groups.get(label) ?? { right: 0, total: 0 };
    group.total += 1;
    if (session.attempts[index]?.score?.status === "correct") group.right += 1;
    groups.set(label, group);
  });
  return [...groups.entries()].map(([label, group]) => ({ label, right: group.right, total: group.total }));
}

function markText(score: Feedback, guessed: boolean): string {
  return guessed ? `Guessed - ${score.label}` : score.label;
}

function statusIcon(status: Feedback["status"]): IconName {
  if (status === "correct") return "circle-check";
  if (status === "partial") return "circle-minus";
  return "circle-x";
}

function durationText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${String(seconds)} sec`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "1 min" : `${String(minutes)} min`;
}
