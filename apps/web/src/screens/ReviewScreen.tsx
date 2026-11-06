import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type CourseDetail, type ReviewList, type ReviewQuestion } from "../api";
import { refreshCatalog } from "../catalog";
import { Button } from "../components/Button";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { EmptyState } from "../components/EmptyState";
import { Icon, type IconName } from "../components/Icon";
import { folderLabel } from "../course/folders";
import { useCourseVersion } from "../course/deletion";
import { courseName } from "../course/pages";
import { useCourse, useCourseNaming } from "../course/useCourse";
import { useFrozen } from "../frozen";
import { navigate } from "../router";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";
import { when } from "../when";

type ReviewFilter = ReviewList["filter"];

const FILTERS: readonly { id: ReviewFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "missed", label: "Missed" },
  { id: "partial", label: "Partly right" },
  { id: "guessed", label: "Guessed" },
];

export function ReviewScreen({ courseId }: { courseId: string }) {
  const { guard } = useFrozen();
  // Her folders, so a folder name two exam pages share says which page.
  const { course: detail } = useCourse(courseId);
  const { name, words } = useCourseNaming(courseId, detail);
  // A delete or an Undo changes what Review holds.
  const version = useCourseVersion(courseId);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [review, setReview] = useState<ReviewList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    document.title = detail ? `${courseName(detail)} Review · Qbank` : "Review · Qbank";
  }, [detail]);

  useEffect(() => {
    let cancel = false;
    void api<ReviewList>(`/api/courses/${courseId}/review?filter=${filter}`)
      .then((body) => {
        if (cancel) return;
        setError(null);
        setReview(body);
      })
      .catch((caught: unknown) => {
        if (!cancel) setError(caught instanceof ApiError ? caught.message : "Could not load Review.");
      });
    return () => {
      cancel = true;
    };
  }, [courseId, filter, tick, version]);

  const dismiss = useCallback(() => {
    setConfirming(false);
  }, []);

  const confirmClear = () => {
    setConfirming(false);
    void api(`/api/courses/${courseId}/review/clear`, { method: "POST", json: { confirmed: true } })
      .then(() => {
        setTick((value) => value + 1);
        return refreshCatalog();
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : "Could not clear Review.");
      });
  };

  const visible = review?.questions ?? [];
  const selectedCount = review?.counts[filter] ?? 0;
  const allCount = review?.counts.all ?? 0;

  return (
    <Screen title="Review">
      <ShellLink to={`/course/${courseId}`} className="text-action" current={false}>
        {words.Container}
      </ShellLink>
      <p className="note">{name !== null ? `${name} · what you missed or guessed` : "What you missed or guessed"}</p>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="chip-row" role="group" aria-label="Review filters">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="chip"
            aria-pressed={filter === item.id}
            onClick={() => {
              setFilter(item.id);
            }}
          >
            {item.label}
            <span className="chip-count">{review ? review.counts[item.id] : 0}</span>
          </button>
        ))}
      </div>
      {selectedCount > 0 ? (
        <Button
          fullWidth
          onClick={() => {
            navigate(`/course/${courseId}/review/practice?filter=${filter}`);
          }}
        >
          <Icon name="shuffle" size={18} />
          Practice these {selectedCount} (shuffled)
        </Button>
      ) : null}
      {review === null && error === null ? <p className="note">Loading Review.</p> : null}
      {review !== null && visible.length === 0 ? (
        <div className="empty-card">
          <EmptyState
            icon="inbox"
            message="Questions you miss or flag as a guess show up here. They leave when you answer them fully right without guessing."
          />
        </div>
      ) : null}
      {visible.length > 0 ? (
        <ul className="review-list">
          {visible.map((question) => (
            <li key={question.questionId}>
              <button
                type="button"
                className="review-row"
                onClick={() => {
                  navigate(`/course/${courseId}/review/practice?question=${question.questionId}`);
                }}
              >
                <QuestionCopy question={question} course={detail} />
                <StatusMark question={question} />
                <span className="review-chevron">
                  <Icon name="chevron-right" size={18} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {allCount > 0 ? (
        <Button
          variant="plain"
          className="text-danger"
          onClick={guard(() => {
            setConfirming(true);
          })}
        >
          Clear the review list
        </Button>
      ) : null}
      {confirming ? (
        <ConfirmSheet
          title={clearTitle(allCount, words.container)}
          message="Your answers and scores are kept. Only the list is emptied."
          confirmLabel="Clear"
          confirmVariant="destructive"
          onConfirm={confirmClear}
          onCancel={dismiss}
        />
      ) : null}
    </Screen>
  );
}

function clearTitle(count: number, container: string): string {
  const noun = count === 1 ? "question" : "questions";
  return `Clear all ${String(count)} ${noun} from this ${container}'s Review list?`;
}

function QuestionCopy({ question, course }: { question: ReviewQuestion; course: CourseDetail | null }) {
  return (
    <span className="review-copy">
      <span className="review-topic">{question.topic}</span>
      <span className="review-meta">
        {course ? folderLabel(course, question.folderId, question.folderName) : question.folderName} · {question.format}
      </span>
      <span className="review-meta">
        {question.setTitle} · {when(question.answeredAt)}
      </span>
    </span>
  );
}

function StatusMark({ question }: { question: ReviewQuestion }) {
  const mark = markFor(question);
  return (
    <span className={`status-mark ${mark.className}`}>
      <Icon name={mark.icon} size={14} />
      <span className="status-label">{mark.label}</span>
    </span>
  );
}

function markFor(question: ReviewQuestion): { icon: IconName; label: string; className: string } {
  if (question.status === "partial") {
    return {
      icon: "circle-minus",
      label: question.guessed ? "Partly right, guessed" : "Partly right",
      className: "mark-partial",
    };
  }
  if (question.status === "correct") {
    return { icon: "flag", label: "Guessed", className: "mark-guessed" };
  }
  return {
    icon: "circle-x",
    label: question.guessed ? "Missed, guessed" : "Missed",
    className: "mark-missed",
  };
}
