import { useCallback, useState } from "react";
import { ApiError, type ExamSummary } from "../api";
import { navigate } from "../router";
import { startExam, startTap, type ExamChoice, type RunningExam } from "./start";

interface Asking {
  courseId: string;
  choice: ExamChoice;
  exam: ExamSummary;
}

/**
 * Starting an exam from Exam setup or a twin job: Start waits until the screen knows whether an
 * exam is running, asks before ending one, and asks too when the server finds one the screen did
 * not know of (started on another device since). `onRunning` hears what the server said is running.
 */
export function useExamStart(onRunning: (exam: ExamSummary | null) => void) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);

  const send = (courseId: string, choice: ExamChoice, replaces: string | null) => {
    setAsking(null);
    setStarting(true);
    setError(null);
    void startExam(courseId, choice, replaces).then(
      (outcome) => {
        if (outcome.kind === "started") {
          navigate(`/course/${outcome.exam.courseId}/exam/${outcome.exam.id}`);
          return;
        }
        setStarting(false);
        onRunning(outcome.exam);
        if (outcome.exam !== null) setAsking({ courseId, choice, exam: outcome.exam });
        // The exam the user confirmed ending has ended already and none runs now: start, as confirmed.
        else if (replaces !== null) send(courseId, choice, null);
        else setError(outcome.message);
      },
      (caught: unknown) => {
        setStarting(false);
        setError(caught instanceof ApiError ? caught.message : "Could not start the exam.");
      },
    );
  };

  const start = (courseId: string, choice: ExamChoice, running: RunningExam) => {
    const tap = startTap(running, Date.now());
    if (tap.kind === "ask") setAsking({ courseId, choice, exam: tap.exam });
    else if (tap.kind === "start") send(courseId, choice, null);
  };

  const confirm = () => {
    if (asking !== null) send(asking.courseId, asking.choice, asking.exam.id);
  };

  const dismiss = useCallback(() => {
    setAsking(null);
  }, []);

  return { starting, error, asking: asking?.exam ?? null, start, confirm, dismiss };
}
