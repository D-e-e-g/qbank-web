import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, api, type DraftQuestion, type QuestionCopies, type QuestionCopy, type QuestionJob, type QuestionResult, type QuestionSamples } from "../api";
import { Button } from "../components/Button";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { Icon } from "../components/Icon";
import { MoreMenu } from "../components/Menu";
import { TextField } from "../components/TextField";
import { FORMAT_LABELS } from "../practice/model";
import { folderPath, makePath, navigate } from "../router";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";
import {
  acceptWords,
  answerOverride,
  blindCheckLine,
  canReviseSamples,
  choiceKey,
  choiceOptions,
  copiesNote,
  copyAnswer,
  countText,
  finishedLine,
  isWorking,
  jobContainer,
  jobCourseName,
  jobFraction,
  jobHeadline,
  jobPlace,
  jobScreenTitle,
  jobStepLabel,
  keptCopies,
  LEAVE_NOTE,
  letter,
  MAKE_POLL_MS,
  problemText,
  questionShape,
  restCount,
  retakeTitle,
  sampleChanges,
  stepIcon,
  stepProgress,
  stoppedMessage,
  verdictLabel,
  type Verdict,
} from "./states";

/**
 * A set being made: QBank reading the material, her check of five samples or of the questions
 * copied from her photos, the writing, and the finished set. The server does the work. This screen
 * follows it while it is open. A sample opens here, since the practice runner only loads a filed set.
 */
export function JobScreen({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<QuestionJob | null>(null);
  const [gone, setGone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [samples, setSamples] = useState<QuestionSamples | null>(null);
  const [copies, setCopies] = useState<QuestionCopies | null>(null);
  const [result, setResult] = useState<QuestionResult | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [answers, setAnswers] = useState<Record<string, readonly number[]>>({});
  const [sending, setSending] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmRetake, setConfirmRetake] = useState(false);
  const [sampleOpen, setSampleOpen] = useState<{ question: DraftQuestion; number: number } | null>(null);
  const [copyOpen, setCopyOpen] = useState<{ copy: QuestionCopy; number: number } | null>(null);
  const [tick, setTick] = useState(0);
  const held = useRef({ job, samples, copies, result });

  useEffect(() => {
    held.current = { job, samples, copies, result };
  }, [job, samples, copies, result]);

  const working = isWorking(job, gone);

  useEffect(() => {
    if (!working) return;
    const live = { current: true };
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attach = async (next: QuestionJob): Promise<boolean> => {
      const previous = held.current;
      if (next.status === "waiting" && next.waitingFor === "samples") {
        const stale = previous.samples === null || previous.job?.waitingFor !== "samples" || previous.job.updatedAt !== next.updatedAt;
        if (!stale) return live.current;
        const body = await api<QuestionSamples>(`/api/question-jobs/${jobId}/samples`);
        if (!live.current) return false;
        if (previous.samples?.round !== body.round) {
          setVerdicts({});
          setNotes({});
        }
        held.current = { ...held.current, samples: body };
        setSamples(body);
      } else if (next.status === "waiting" && next.waitingFor === "copies" && previous.copies === null) {
        const body = await api<QuestionCopies>(`/api/question-jobs/${jobId}/copies`);
        if (!live.current) return false;
        held.current = { ...held.current, copies: body };
        setCopies(body);
      } else if (next.status === "done" && previous.result === null) {
        const body = await api<QuestionResult>(`/api/question-jobs/${jobId}/result`);
        if (!live.current) return false;
        held.current = { ...held.current, result: body };
        setResult(body);
      }
      return live.current;
    };

    const read = () => {
      void (async () => {
        try {
          const next = await api<QuestionJob>(`/api/question-jobs/${jobId}`);
          if (!live.current) return;
          if (!(await attach(next))) return;
          held.current = { ...held.current, job: next };
          setGone(false);
          setProblem(null);
          setJob(next);
          if (next.status === "running") timer = setTimeout(read, MAKE_POLL_MS);
        } catch (error: unknown) {
          if (!live.current) return;
          if (error instanceof ApiError && error.status === 404) setGone(true);
          setProblem(problemText(error));
          if (!(error instanceof ApiError && error.status === 404)) timer = setTimeout(read, MAKE_POLL_MS);
        }
      })();
    };

    read();
    return () => {
      live.current = false;
      clearTimeout(timer);
    };
  }, [jobId, working, tick]);

  const copiesFound = job?.waitingFor === "copies" && copies ? copies.questions.length : null;
  const title = job ? jobScreenTitle(job, copiesFound) : gone ? "This set is gone" : problem ? "Could not open this set" : "Make questions";

  useEffect(() => {
    document.title = `${title} · Qbank`;
  }, [title]);

  const send = (path: string, json?: unknown) => {
    setProblem(null);
    setSending(true);
    void api<QuestionJob>(path, { method: "POST", json })
      .then((next) => {
        held.current = { ...held.current, job: next };
        setJob(next);
      })
      .catch((error: unknown) => {
        setProblem(problemText(error));
      })
      .finally(() => {
        setSending(false);
      });
  };

  const stop = () => {
    setConfirmStop(false);
    setSending(true);
    setProblem(null);
    void api<QuestionJob>(`/api/question-jobs/${jobId}/cancel`, { method: "POST" })
      .then(() => {
        navigate("/import");
      })
      .catch((error: unknown) => {
        setProblem(problemText(error));
        setSending(false);
      });
  };

  const retake = () => {
    if (!job) return;
    const courseId = job.course.id;
    setConfirmRetake(false);
    setSending(true);
    setProblem(null);
    void api<QuestionJob>(`/api/question-jobs/${jobId}/cancel`, { method: "POST" })
      .then(() => {
        navigate(makePath({ courseId, keep: true }));
      })
      .catch((error: unknown) => {
        setProblem(problemText(error));
        setSending(false);
      });
  };

  const step = job ? jobStepLabel(job) : null;
  const menu = job && (job.status === "running" || job.status === "waiting");
  const action = menu ? (
    <MoreMenu
      name="this set"
      items={[
        {
          key: "stop",
          label: "Stop making this set",
          icon: "circle-x",
          destructive: true,
          onSelect: () => {
            setConfirmStop(true);
          },
        },
      ]}
    />
  ) : job?.status === "done" ? (
    <button
      type="button"
      className="text-action"
      onClick={() => {
        navigate("/import");
      }}
    >
      Done
    </button>
  ) : undefined;

  return (
    <Screen title={title} action={action}>
      {step ? <p className="make-step">{step}</p> : null}
      {job?.status === "done" ? null : (
        <ShellLink to="/import" className="text-action" current={false}>
          Import
        </ShellLink>
      )}
      {job?.status === "running" ? <Working job={job} problem={problem} /> : null}
      {job?.status === "waiting" && job.waitingFor === "copies" && copies ? (
        <Copies
          job={job}
          copies={copies}
          skipped={skipped}
          answers={answers}
          sending={sending}
          problem={problem}
          onOpen={setCopyOpen}
          onAdd={() => {
            const keep = keptCopies(copies, skipped, answers);
            if (keep.length === 0) return;
            send(`/api/question-jobs/${jobId}/copies/accept`, { keep });
          }}
          onRetake={() => {
            setConfirmRetake(true);
          }}
        />
      ) : null}
      {job?.status === "waiting" && job.waitingFor !== "copies" && samples ? (
        <Samples
          job={job}
          samples={samples}
          verdicts={verdicts}
          notes={notes}
          sending={sending}
          problem={problem}
          onOpen={setSampleOpen}
          onVerdict={(id, verdict) => {
            setVerdicts((current) => ({ ...current, [id]: verdict }));
          }}
          onNote={(id, note) => {
            setNotes((current) => ({ ...current, [id]: note }));
          }}
          onAccept={() => {
            const changes = sampleChanges(samples.questions, verdicts, notes);
            const words = acceptWords(samples.questions, changes);
            send(`/api/question-jobs/${jobId}/samples/accept`, words ? { words } : {});
          }}
          onRevise={() => {
            const changes = sampleChanges(samples.questions, verdicts, notes);
            if (!canReviseSamples(samples.canRevise, changes)) return;
            send(`/api/question-jobs/${jobId}/samples/revise`, { changes });
          }}
        />
      ) : null}
      {job?.status === "waiting" && ((job.waitingFor === "copies" && !copies) || (job.waitingFor !== "copies" && !samples)) ? <p className="note">Loading.</p> : null}
      {job?.status === "done" && result ? (
        <Finished
          job={job}
          result={result}
          onPractice={() => {
            navigate(`/course/${job.course.id}/practice/${result.set.setId}`);
          }}
          onOpen={() => {
            navigate(folderPath(job.course.id, result.set.folderId));
          }}
        />
      ) : null}
      {job?.status === "done" && !result ? <p className="note">Loading.</p> : null}
      {job && (job.status === "failed" || job.status === "cancelled") ? (
        <Stopped
          job={job}
          problem={problem}
          onStartOver={() => {
            navigate(makePath({ courseId: job.course.id, keep: true }));
          }}
        />
      ) : null}
      {!job && problem ? (
        <>
          <p className="form-error">{problem}</p>
          {gone ? null : (
            <Button
              variant="secondary"
              onClick={() => {
                setTick((current) => current + 1);
              }}
            >
              Try again
            </Button>
          )}
        </>
      ) : null}
      {!job && !problem ? <p className="note">Loading.</p> : null}
      {confirmStop && job ? (
        <ConfirmSheet
          title="Stop making this set?"
          message={`Nothing is added to your ${jobContainer(job.course)}, and your material is deleted.`}
          confirmLabel="Stop and delete it"
          confirmVariant="destructive"
          onConfirm={stop}
          onCancel={() => {
            setConfirmStop(false);
          }}
        />
      ) : null}
      {confirmRetake && copies ? (
        <ConfirmSheet
          title={retakeTitle(copies)}
          message="The questions found in these photos are let go."
          confirmLabel="Start over with new photos"
          confirmVariant="destructive"
          onConfirm={retake}
          onCancel={() => {
            setConfirmRetake(false);
          }}
        />
      ) : null}
      {sampleOpen ? (
        <SampleSheet
          question={sampleOpen.question}
          number={sampleOpen.number}
          onClose={() => {
            setSampleOpen(null);
          }}
        />
      ) : null}
      {copyOpen ? (
        <CopySheet
          copy={copyOpen.copy}
          number={copyOpen.number}
          skipped={skipped.has(copyOpen.copy.id)}
          chosen={answers[copyOpen.copy.id]}
          onUse={(picks) => {
            const id = copyOpen.copy.id;
            const override = answerOverride(copyOpen.copy.question, picks);
            setAnswers((current) => {
              if (override) return { ...current, [id]: override };
              return Object.fromEntries(Object.entries(current).filter(([key]) => key !== id));
            });
            setCopyOpen(null);
          }}
          onSkip={() => {
            const id = copyOpen.copy.id;
            setSkipped((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
            setCopyOpen(null);
          }}
          onClose={() => {
            setCopyOpen(null);
          }}
        />
      ) : null}
    </Screen>
  );
}

function Working({ job, problem }: { job: QuestionJob; problem: string | null }) {
  const fraction = jobFraction(job);
  return (
    <>
      <p className="note">{jobPlace(job)}</p>
      <div className="make-progress">
        <p className="make-headline">{jobHeadline(job)}</p>
        {fraction === null ? null : (
          <span className="progress-track" role="progressbar" aria-label="Done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
            <span className="progress-fill" style={{ width: `${String(Math.round(fraction * 100))}%` }} />
          </span>
        )}
      </div>
      <Steps job={job} />
      <p className="field-hint">{LEAVE_NOTE}</p>
      {problem ? <p className="form-error">{problem}</p> : null}
    </>
  );
}

function Steps({ job }: { job: QuestionJob }) {
  return (
    <section className="group">
      <ul className="review-list" aria-label="Steps">
        {job.steps.map((step) => (
          <li key={step.key}>
            <div className={`review-row twin-step twin-step-${step.state}${step.state === "waiting" ? " make-waiting" : ""}`}>
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

function Samples({
  job,
  samples,
  verdicts,
  notes,
  sending,
  problem,
  onOpen,
  onVerdict,
  onNote,
  onAccept,
  onRevise,
}: {
  job: QuestionJob;
  samples: QuestionSamples;
  verdicts: Readonly<Record<string, Verdict>>;
  notes: Readonly<Record<string, string>>;
  sending: boolean;
  problem: string | null;
  onOpen: (sample: { question: DraftQuestion; number: number }) => void;
  onVerdict: (id: string, verdict: Verdict) => void;
  onNote: (id: string, note: string) => void;
  onAccept: () => void;
  onRevise: () => void;
}) {
  const changes = sampleChanges(samples.questions, verdicts, notes);
  const changing = samples.questions.filter((question) => verdicts[question.id] === "change");
  return (
    <>
      <p className="note">Open each one and answer it like practice. Mark anything off; the other {restCount(job, samples.questions.length)} follow your notes.</p>
      {samples.note ? <p className="sample-note">{samples.note}</p> : null}
      <ul className="review-list" aria-label="Samples">
        {samples.questions.map((question, index) => {
          const verdict = verdicts[question.id] ?? "notChecked";
          const number = index + 1;
          return (
            <li key={question.id}>
              <div className="review-row sample-row">
                <button
                  type="button"
                  className="sample-open"
                  onClick={() => {
                    onOpen({ question, number });
                  }}
                >
                  <span className="position-mark">{number}</span>
                  <span className="review-copy">
                    <span className="review-topic">{question.topic}</span>
                    <span className="review-meta">{[FORMAT_LABELS[question.type], question.cj].filter((part) => part !== null && part !== "").join(" · ")}</span>
                  </span>
                </button>
                <select
                  className="control verdict"
                  aria-label={`Sample ${String(number)}: ${verdictLabel(verdict)}`}
                  value={verdict}
                  onChange={(event) => {
                    onVerdict(question.id, event.target.value as Verdict);
                  }}
                >
                  <option value="looksRight">Looks right</option>
                  <option value="change">Change</option>
                  <option value="notChecked">Not checked</option>
                </select>
              </div>
            </li>
          );
        })}
      </ul>
      {changing.map((question) => {
        const number = samples.questions.findIndex((item) => item.id === question.id) + 1;
        return (
          <TextField
            key={question.id}
            label={`What to change (sample ${String(number)})`}
            multiline
            value={notes[question.id] ?? ""}
            hint="What the rest should do differently"
            onChange={(note) => {
              onNote(question.id, note);
            }}
          />
        );
      })}
      {problem ? <p className="form-error">{problem}</p> : null}
      <div className="make-actions">
        <Button fullWidth className="btn-lg" disabled={sending} onClick={onAccept}>
          {`Write the other ${String(restCount(job, samples.questions.length))}`}
        </Button>
        {samples.canRevise ? (
          <Button fullWidth variant="plain" className="btn-lg" disabled={sending || !canReviseSamples(samples.canRevise, changes)} onClick={onRevise}>
            Redo the samples
          </Button>
        ) : null}
      </div>
    </>
  );
}

function Copies({
  job,
  copies,
  skipped,
  answers,
  sending,
  problem,
  onOpen,
  onAdd,
  onRetake,
}: {
  job: QuestionJob;
  copies: QuestionCopies;
  skipped: ReadonlySet<string>;
  answers: Readonly<Record<string, readonly number[] | undefined>>;
  sending: boolean;
  problem: string | null;
  onOpen: (open: { copy: QuestionCopy; number: number }) => void;
  onAdd: () => void;
  onRetake: () => void;
}) {
  const kept = copies.questions.filter((copy) => !skipped.has(copy.id)).length;
  return (
    <>
      <p className="note">{copiesNote(copies, job)}</p>
      <ul className="review-list" aria-label="Questions found">
        {copies.questions.map((copy, index) => {
          const number = index + 1;
          const isSkipped = skipped.has(copy.id);
          const line = copyAnswer(copy, answers[copy.id] ?? null);
          const suggested = copy.answerFrom === "suggested" && answers[copy.id] === undefined;
          return (
            <li key={copy.id}>
              <button
                type="button"
                className={isSkipped ? "review-row make-skipped" : "review-row"}
                onClick={() => {
                  onOpen({ copy, number });
                }}
              >
                <span className="position-mark">{number}</span>
                <span className="review-copy">
                  <span className="review-topic">{questionShape(copy.question)}</span>
                  <span className="review-meta make-stem">{copy.question.stem}</span>
                  {isSkipped ? <span className="status-mark">Left out</span> : null}
                  {!isSkipped && line ? <span className={suggested ? "status-mark mark-partial" : "status-mark mark-guessed"}>{line}</span> : null}
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            </li>
          );
        })}
        {copies.unreadable.map((item, index) => (
          <li key={`${String(item.photo ?? "file")}-${String(index)}`}>
            <div className="review-row">
              <span className="position-mark">{copies.questions.length + index + 1}</span>
              <span className="review-copy">
                <span className="review-topic">Could not read it</span>
                <span className="review-meta">{item.reason}</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {job.examTwins ? <p className="field-hint">QBank also writes an exam twin for each, so the exam asks it in new words.</p> : null}
      {problem ? <p className="form-error">{problem}</p> : null}
      <div className="make-actions">
        <Button fullWidth className="btn-lg" disabled={sending || kept === 0} onClick={onAdd}>
          {`Add ${countText(kept, "question")} to ${job.folder.name}`}
        </Button>
        <Button fullWidth variant="plain" className="btn-lg" disabled={sending} onClick={onRetake}>
          {retakeTitle(copies)}
        </Button>
      </div>
    </>
  );
}

function Finished({ job, result, onPractice, onOpen }: { job: QuestionJob; result: QuestionResult; onPractice: () => void; onOpen: () => void }) {
  return (
    <>
      <div className="make-done">
        <Icon name="circle-check" size={48} />
        <p className="note">{finishedLine(result, jobCourseName(job.course))}</p>
      </div>
      <ul className="review-list" aria-label="What was filed">
        <li>
          <div className="review-row">
            <span className="review-topic">{result.blindCheck ? blindCheckLine(result.blindCheck) : `${countText(result.set.questionCount, "question")} checked by you`}</span>
          </div>
        </li>
        {result.suggestedAnswers.length > 0 ? (
          <li>
            <div className="review-row">
              <span className="review-copy">
                <span className="review-topic">{countText(result.suggestedAnswers.length, "answer")} suggested by QBank</span>
                <span className="review-meta">The photo marked none</span>
              </span>
            </div>
          </li>
        ) : null}
        {result.examSet ? (
          <li>
            <div className="review-row">
              <span className="review-topic">{`${countText(result.examSet.questionCount, "exam twin")} in the ${result.examSet.folderName} exam bank`}</span>
            </div>
          </li>
        ) : null}
        {result.set.termCount > 0 ? (
          <li>
            <div className="review-row">
              <span className="review-copy">
                <span className="review-topic">{countText(result.set.termCount, "term")}</span>
                <span className="review-meta">Added to Terms</span>
              </span>
            </div>
          </li>
        ) : null}
      </ul>
      <div className="make-actions">
        <Button fullWidth className="btn-lg" onClick={onPractice}>
          Practice now
        </Button>
        <Button fullWidth variant="secondary" className="btn-lg" onClick={onOpen}>
          {`Open ${result.set.folderName}`}
        </Button>
      </div>
    </>
  );
}

function Stopped({ job, problem, onStartOver }: { job: QuestionJob; problem: string | null; onStartOver: () => void }) {
  return (
    <>
      <p>{stoppedMessage(job)}</p>
      <Steps job={job} />
      {problem ? <p className="form-error">{problem}</p> : null}
      <div className="make-actions">
        <Button fullWidth className="btn-lg" onClick={onStartOver}>
          Start over
        </Button>
        <ShellLink to="/import" className="btn btn-plain btn-full btn-lg" current={false}>
          Back to Import
        </ShellLink>
      </div>
    </>
  );
}

/** One sample, to answer like practice. The right answer stays hidden: this is her check, not a score. */
function SampleSheet({ question, number, onClose }: { question: DraftQuestion; number: number; onClose: () => void }) {
  const options = choiceOptions(question);
  const [picks, setPicks] = useState<ReadonlySet<number>>(new Set());
  const multi = question.type === "sata";
  return (
    <DetailSheet title={`Sample ${String(number)}`} onClose={onClose}>
      <p className="review-meta">{questionShape(question)}</p>
      <p className="make-stem-full">{question.stem}</p>
      {question.ask === "" ? null : <p className="make-ask">{question.ask}</p>}
      {options ? (
        <div className="choice-list" role={multi ? "group" : "radiogroup"} aria-label="Choices">
          {options.map((option, index) => {
            const on = picks.has(index);
            return (
              <button
                key={index}
                type="button"
                className={on ? "choice choice-selected" : "choice"}
                role={multi ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => {
                  setPicks((current) => {
                    if (!multi) return new Set([index]);
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  });
                }}
              >
                <span className="choice-letter" aria-hidden="true">
                  {letter(index)}
                </span>
                <span className="choice-text">{option.text}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="field-hint">Answer this format in practice once the set is filed. Mark the sample on its row if something is off.</p>
      )}
    </DetailSheet>
  );
}

/** One copied question: set the right answer, or leave it out. */
function CopySheet({
  copy,
  number,
  skipped,
  chosen,
  onUse,
  onSkip,
  onClose,
}: {
  copy: QuestionCopy;
  number: number;
  skipped: boolean;
  chosen: readonly number[] | undefined;
  onUse: (picks: readonly number[]) => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const options = choiceOptions(copy.question);
  const [picks, setPicks] = useState<ReadonlySet<number>>(() => new Set(chosen ?? choiceKey(copy.question)));
  const multi = copy.question.type === "sata";
  return (
    <DetailSheet title={`Question ${String(number)}`} onClose={onClose}>
      <p className="review-meta">{questionShape(copy.question)}</p>
      <p className="make-stem-full">{copy.question.stem}</p>
      {copy.question.ask === "" ? null : <p className="make-ask">{copy.question.ask}</p>}
      {options ? (
        <>
          {copy.answerFrom === "suggested" ? <p className="field-hint">The photo marks no answer. QBank picked the one below; check it.</p> : null}
          <div className="choice-list" role={multi ? "group" : "radiogroup"} aria-label="Choices">
            {options.map((option, index) => {
              const on = picks.has(index);
              return (
                <button
                  key={index}
                  type="button"
                  className={on ? "choice choice-selected" : "choice"}
                  role={multi ? "checkbox" : "radio"}
                  aria-checked={on}
                  onClick={() => {
                    setPicks((current) => {
                      if (!multi) return new Set([index]);
                      const next = new Set(current);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    });
                  }}
                >
                  <span className="choice-letter" aria-hidden="true">
                    {letter(index)}
                  </span>
                  <span className="choice-text">{option.text}</span>
                </button>
              );
            })}
          </div>
          <Button
            fullWidth
            className="btn-lg"
            disabled={picks.size === 0}
            onClick={() => {
              onUse([...picks]);
            }}
          >
            Use this answer
          </Button>
        </>
      ) : (
        <p className="field-hint">Its answer is kept as it was copied. Leave it out if it looks wrong.</p>
      )}
      {copy.explanationsFrom === "qbank" ? <p className="field-hint">The photo has no explanations, so QBank wrote them.</p> : null}
      <Button fullWidth variant="secondary" className="btn-lg" onClick={onSkip}>
        {skipped ? "Put it back" : "Leave this one out"}
      </Button>
    </DetailSheet>
  );
}

function DetailSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="sheet sheet-form"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="sheet-head">
          <button type="button" className="sheet-head-action" onClick={onClose}>
            Close
          </button>
          <h2 className="sheet-head-title">{title}</h2>
          <span />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
