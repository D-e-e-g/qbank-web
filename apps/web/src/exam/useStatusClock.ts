import { useEffect, useState } from "react";
import type { ExamSummary } from "../api";
import { examStatus, nextStatusChange } from "./status";

/**
 * This device's clock for a screen that shows the user's open exam, read again each time what
 * `examStatus` or `minutesLeft` say about that exam changes, so a screen left open moves on from
 * running to its grace and then to ended without a tap. `onTimeUp` hears when its time is up.
 */
export function useStatusClock(exam: ExamSummary | null, onTimeUp: () => void): number {
  const [now, setNow] = useState(() => Date.now());
  const at = exam === null ? null : nextStatusChange(exam, now);
  useEffect(() => {
    if (exam === null || at === null) return;
    // Never earlier than `at`, so a timer that fires a moment early still moves on.
    const timer = setTimeout(
      () => {
        const next = Math.max(Date.now(), at);
        setNow(next);
        if (examStatus(exam, next) === "ended") onTimeUp();
      },
      Math.max(0, at - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [at, exam, onTimeUp]);
  return now;
}
