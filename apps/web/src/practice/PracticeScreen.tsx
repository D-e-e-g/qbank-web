import { useEffect, useReducer, useRef, useState, type Ref } from "react";
import { ApiError, api } from "../api";
import { Button } from "../components/Button";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { Icon, type IconName } from "../components/Icon";
import { useFrozen } from "../frozen";
import { navigate } from "../router";
import { AnswerArea } from "./Answers";
import { Markable, MarkingProvider } from "./highlight/Markable";
import { QuestionMeta } from "./highlight/QuestionMeta";
import { RationaleImages, StemExhibits } from "./Exhibits";
import { scoreOf } from "./attempt";
import { FORMAT_LABELS, toggleStrike, toResponse } from "./model";
import { NewRunNotice } from "./NewRunNotice";
import { openPractice } from "./open";
import type { PracticeSource } from "./source";
import { recordPracticeAnswer, type Feedback } from "./recordPracticeAnswer";
import { MeterList, ScoreSummary } from "./ResultCharts";
import { RunnerShell } from "./RunnerShell";
import { answeredCount, nextIndex, pickedUpLine, progressStrip, practiceStep, startOverMessage, type Session } from "./session";

export function PracticeScreen({ courseId, source, wide }: { courseId: string; source: PracticeSource; wide: boolean }) {
  const [opened, setOpened] = useState<{ session: Session; nth: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void openPractice(courseId, source).then((opening) => {
      if (cancel) return;
      if ("error" in opening) {
        setError(opening.error);
        return;
      }
      setError(null);
      setOpened((last) => ({ session: opening.session, nth: (last?.nth ?? 0) + 1 }));
    });
    return () => {
      cancel = true;
    };
  }, [courseId, source]);

  if (!opened) {
    return (
      <RunnerShell
        wide={wide}
        title="Practice"
        count=""
        onClose={() => {
          navigate(source.closeTo);
        }}
      >
        <p className="note">{error ?? (source.kind === "review" ? "Loading Review." : "Loading the set.")}</p>
      </RunnerShell>
    );
  }

  // Keyed, so a set read again begins a new runner, and a reply meant for the one before lands nowhere.
  return <PracticeRunner key={opened.nth} opened={opened.session} source={source} wide={wide} />;
}

function PracticeRunner({ opened, source, wide }: { opened: Session; source: PracticeSource; wide: boolean }) {
  const { guard } = useFrozen();
  const [session, dispatch] = useReducer(practiceStep, opened);
  const [askingStartOver, setAskingStartOver] = useState(false);

  useEffect(() => {
    document.title = `${session.title} · Qbank`;
  }, [session.title]);

  const loaded = session.questions[session.index];
  const attempt = session.attempts[session.index];
  const score = attempt ? scoreOf(attempt) : null;

  const feedbackRef = useRef<HTMLDivElement>(null);
  const revealedKey = score ? String(session.index) : "";
  useEffect(() => {
    if (revealedKey === "") return;
    feedbackRef.current?.scrollIntoView({ block: "nearest" });
  }, [revealedKey]);

  // The answer on its way: what was sent, never the answer area as it is now. Each of these stays the
  // same value for as long as the question is being checked, so the answer is posted once. Leaving
  // the runner does not stop its retries: the answer is still saved once the connection is back.
  const sent = attempt?.phase.phase === "checking" ? attempt.phase.sent : null;
  const questionId = loaded?.id;
  const clientAttemptId = attempt?.clientAttemptId;
  const guessed = attempt?.guessed;
  const layout = attempt?.layout;
  const fromReview = session.kind === "review";
  useEffect(() => {
    if (sent === null || questionId === undefined || clientAttemptId === undefined || guessed === undefined || layout === undefined) return;
    void recordPracticeAnswer({ clientAttemptId, questionId, response: sent, guessed, layout, fromReview }, () => {
      dispatch({ type: "checkRetrying", clientAttemptId });
    }).then(
      (saved) => {
        dispatch({ type: "checked", clientAttemptId, score: saved });
      },
      (caught: unknown) => {
        dispatch({ type: "checkFailed", clientAttemptId, message: caught instanceof ApiError ? caught.message : "Could not save that answer." });
      },
    );
  }, [sent, questionId, clientAttemptId, guessed, layout, fromReview]);

  // Asking the server to begin the set again.
  const { startingOver } = session;
  const startOverPath = `${source.loadPath}/start-over`;
  useEffect(() => {
    if (!startingOver) return;
    void api(startOverPath, { method: "POST" }).then(
      () => {
        dispatch({ type: "startedOver" });
      },
      (caught: unknown) => {
        dispatch({ type: "startOverFailed", message: caught instanceof ApiError ? caught.message : "Could not start over. Check your connection and try again." });
      },
    );
  }, [startingOver, startOverPath]);

  const close = () => {
    navigate(source.closeTo);
  };

  if (session.finishedAt !== null) {
    return <Results session={session} wide={wide} closeLabel={source.closeLabel} onClose={close} />;
  }

  if (!loaded || !attempt) {
    return (
      <RunnerShell wide={wide} title={session.title} count="" onClose={close}>
        <p className="note">{session.kind === "review" ? "Nothing to review here right now." : "This set has no questions."}</p>
      </RunnerShell>
    );
  }

  const { phase } = attempt;
  const revealed = phase.phase === "revealed";
  // The answer is taken only while the question is open and the set is not beginning again.
  const answering = phase.phase === "open" && !startingOver;
  const response = toResponse(attempt.draft);
  const last = nextIndex(session) === -1;

  return (
    <RunnerShell
      wide={wide}
      title={session.title}
      count={`${String(session.index + 1)} of ${String(session.questions.length)}`}
      progress={answeredCount(session) / session.questions.length}
      strip={progressStrip(session)}
      onClose={close}
      footer={
        revealed ? (
          <Button
            fullWidth
            disabled={startingOver}
            onClick={() => {
              dispatch({ type: "next" });
            }}
          >
            {last ? "See results" : "Next question"}
          </Button>
        ) : (
          <Button
            fullWidth
            disabled={response === null || !answering}
            onClick={guard(() => {
              dispatch({ type: "check" });
            })}
          >
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
            disabled={phase.phase === "checking" || startingOver}
            onClick={guard(() => {
              setAskingStartOver(true);
            })}
          >
            Start over
          </button>
        </div>
      ) : null}
      <NewRunNotice session={session} />
      {session.error ? <p className="form-error">{session.error}</p> : null}
      {phase.phase === "checking" && phase.retrying ? (
        <p className="status-banner" role="status">
          <Icon name="clock" size={16} />
          <span>No connection. Your answer is saved as soon as you are back online.</span>
        </p>
      ) : null}
      <MarkingProvider
        marks={attempt.marks}
        onChange={(marks) => {
          dispatch({ type: "mark", marks });
        }}
      >
        <QuestionMeta format={FORMAT_LABELS[loaded.question.type]} topic={loaded.topic} />
        <p className="runner-stem">
          <Markable piece="stem" text={loaded.stem} />
        </p>
        <StemExhibits loaded={loaded} />
        <p className="runner-ask">
          <Markable piece="ask" text={loaded.ask} />
        </p>
        {score ? <FeedbackBanner score={score} guessed={attempt.guessed} bannerRef={feedbackRef} /> : null}
        <AnswerArea
          loaded={loaded}
          layout={attempt.layout}
          draft={attempt.draft}
          struck={attempt.struck}
          revealed={revealed}
          onDraft={(draft) => {
            dispatch({ type: "edit", change: () => ({ draft }) });
          }}
          onStrike={
            revealed
              ? undefined
              : (option) => {
                  dispatch({ type: "edit", change: (entry) => toggleStrike(entry.draft, entry.struck, option) });
                }
          }
        />
      </MarkingProvider>
      {revealed ? null : (
        <label className="guess-row">
          <input
            type="checkbox"
            checked={attempt.guessed}
            disabled={!answering}
            onChange={(event) => {
              const flagged = event.target.checked;
              dispatch({ type: "edit", change: () => ({ guessed: flagged }) });
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
          onConfirm={() => {
            setAskingStartOver(false);
            dispatch({ type: "startOver" });
          }}
          onCancel={() => {
            setAskingStartOver(false);
          }}
        />
      ) : null}
    </RunnerShell>
  );
}

function Results({ session, wide, closeLabel, onClose }: { session: Session; wide: boolean; closeLabel: string; onClose: () => void }) {
  const scores = session.attempts.map(scoreOf);
  const fullyRight = scores.filter((score) => score?.status === "correct").length;
  const partial = scores.filter((score) => score?.status === "partial").length;
  const missed = scores.filter((score) => score?.status === "incorrect").length;
  const guessed = session.attempts.filter((attempt, index) => attempt.guessed && scores[index]).length;
  let points = 0;
  let maxPoints = 0;
  for (const score of scores) {
    if (!score) continue;
    points += score.points;
    maxPoints += score.maxPoints;
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
          <ScoreSummary right={fullyRight} partial={partial} missed={missed} guessed={guessed} />
          <section className="result-section">
            <h2 className="result-heading">By clinical judgment step</h2>
            <MeterList label="By clinical judgment step" rows={judgmentRows(session)} />
          </section>
          <section className="result-section">
            <h2 className="result-heading">Questions</h2>
            <div className="result-list">
              {session.questions.map((question, index) => {
                const score = scores[index];
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
                        {score ? markText(score, session.attempts[index]?.guessed === true) : "Not answered"}
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
    const attempt = session.attempts[index];
    if (attempt && scoreOf(attempt)?.status === "correct") group.right += 1;
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

/** The banner the server's score fills in. The screen never scores the answer itself. */
export function FeedbackBanner({
  score,
  guessed,
  bannerRef,
}: {
  score: Feedback;
  guessed: boolean;
  bannerRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div className={`feedback feedback-${score.status}`} role="status" ref={bannerRef}>
      <p className="feedback-label">
        <Icon name={statusIcon(score.status)} />
        {score.label}
      </p>
      {score.pointsText ? <p className="feedback-detail">{score.pointsText}</p> : null}
      {score.ruleText ? <p className="feedback-detail">{score.ruleText}</p> : null}
      {guessed ? <p className="feedback-detail">Flagged as a guess</p> : null}
    </div>
  );
}

function durationText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${String(seconds)} sec`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "1 min" : `${String(minutes)} min`;
}
