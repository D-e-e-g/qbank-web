import type { ExamBreakdownRow, ExamItemResult } from "../api";
import { useCatalogCourse } from "../catalog";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { kindWords } from "../course/pages";
import { navigate } from "../router";
import { AnswerArea } from "../practice/Answers";
import { RationaleImages, StemExhibits } from "../practice/Exhibits";
import { FORMAT_LABELS, draftFromResponse, initialDraft, readLayout, type LoadedQuestion } from "../practice/model";
import type { LoadedExam } from "./ExamScreen";
import { foldersText, practiceFoldersText } from "./names";

/** An ended exam: the score, the breakdowns, and each question with its mark and explanation. */
export function ExamResultView({ exam, wide }: { exam: LoadedExam; wide: boolean }) {
  const view = exam.view;
  const words = kindWords(useCatalogCourse(view.courseId)?.kind ?? "course");
  const result = view.result;
  if (result === null) return null;
  const itemById = new Map(result.items.map((item) => [item.questionId, item]));
  const practiceFolders = view.practiceWeeks ?? [];
  const bankWrong = result.examBankWrong;

  return (
    <div className={wide ? "runner runner-wide runner-results" : "runner runner-results"}>
      <div className="runner-scroll">
        <div className="runner-column result-column">
          <div className="result-head">
            <div className="result-done">
              <Button
                variant="plain"
                onClick={() => {
                  navigate(`/course/${view.courseId}/exam`);
                }}
              >
                Done
              </Button>
            </div>
            <p className="runner-kicker">
              Exam result · {foldersText(view.weeks)}
              {view.pool === "wrong" ? " · Wrong questions only" : ""}
            </p>
            <h1 className="result-title">
              {result.fullyRight} of {result.questionCount} fully right
            </h1>
            <p className="result-sub">
              {result.points} of {result.maxPoints} points · {result.minutesUsed} min
              {view.endReason === "timeout" ? " · Time ran out" : view.endReason === "left" ? " · Ended early" : ""}
            </p>
            {practiceFolders.length > 0 ? <p className="note">{practiceFoldersText(practiceFolders, "after")}</p> : null}
          </div>
          <ul className="result-stats exam-stats" aria-label="Score summary">
            <li>
              <strong>{result.partial}</strong>
              Partly right
            </li>
            <li>
              <strong>{result.missed}</strong>
              Missed
            </li>
            <li>
              <strong>{result.guessed}</strong>
              Guessed
            </li>
            <li>
              <strong>{result.unanswered}</strong>
              Not answered
            </li>
          </ul>
          {result.reviewCount > 0 ? (
            <Button
              fullWidth
              className="btn-lg"
              onClick={() => {
                navigate(`/course/${view.courseId}/review`);
              }}
            >
              <Icon name="inbox" size={18} />
              Open Review · {result.reviewCount} from this exam
            </Button>
          ) : null}
          {bankWrong > 0 ? <p className="note">{bankWrongText(bankWrong)}</p> : null}
          <Breakdown title="By folder" rows={result.byFolder} />
          <Breakdown title="By clinical judgment step" rows={result.byStep} />
          <section className="result-section">
            <h2 className="result-heading">Questions</h2>
            <div className="result-list">
              {exam.questions.map((question, index) => {
                const item = itemById.get(question.id);
                return item ? <ResultQuestion key={question.id} question={question} item={item} position={index + 1} /> : null;
              })}
            </div>
          </section>
          <Button
            fullWidth
            variant="secondary"
            className="btn-lg"
            onClick={() => {
              navigate(`/course/${view.courseId}`);
            }}
          >
            Back to {words.container}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: ExamBreakdownRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="result-section">
      <h2 className="result-heading">{title}</h2>
      <ul className="judgment" aria-label={title}>
        {rows.map((row) => (
          <li key={row.label}>
            <span>{row.label}</span>
            <span className="judgment-count">
              {row.right} of {row.total}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResultQuestion({ question, item, position }: { question: LoadedQuestion; item: ExamItemResult; position: number }) {
  const layout = readLayout(question.question, item.shuffle);
  const draft = draftFromResponse(question.question, item.response) ?? initialDraft(question.question, layout);
  const answered = item.status !== "unanswered";
  return (
    <details className="result-question">
      <summary>
        <span className="order-pos">{position}</span>
        <span className="result-question-copy">
          <span className="choice-text">{question.topic || question.publicId}</span>
          <span className="course-meta">
            {FORMAT_LABELS[question.question.type]} · {item.points} of {item.maxPoints}
          </span>
        </span>
        <span className={answered ? `result-mark result-mark-${item.status}` : "result-mark result-mark-unanswered"}>{markText(item)}</span>
      </summary>
      <div className="result-detail">
        <p className="runner-prose">{question.stem}</p>
        <StemExhibits loaded={question} />
        <p className="runner-prose">
          <strong>{question.ask}</strong>
        </p>
        {answered ? null : <p className="note">Not answered. The right answer is marked below.</p>}
        <AnswerArea loaded={question} layout={layout} draft={draft} revealed onDraft={() => undefined} />
        <p className="runner-prose">{question.rationale}</p>
        <RationaleImages loaded={question} />
        <p className="takeaway runner-prose">{question.takeaway}</p>
      </div>
    </details>
  );
}

/** Exam-bank questions stay out of Review, so the result says where the wrong ones went. */
function bankWrongText(count: number): string {
  const one = count === 1;
  const lead = `${String(count)} exam-bank ${one ? "question" : "questions"} you got wrong ${one ? "stays" : "stay"} out of Review.`;
  return `${lead} Turn on Wrong questions only to take ${one ? "it" : "them"} again.`;
}

/** The server's mark, "Not answered" included, with the guess she flagged. */
function markText(item: ExamItemResult): string {
  return item.guessed && item.status !== "unanswered" ? `Guessed - ${item.label}` : item.label;
}
