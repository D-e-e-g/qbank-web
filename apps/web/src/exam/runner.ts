import type { ExamEndReason } from "../api";
import type { Marks } from "../practice/highlight/marks";
import { toResponse, type Draft, type Layout } from "../practice/model";
import type { StripStep } from "../practice/RunnerShell";

/** One question of a running exam, as this sitting has it. */
export interface ItemState {
  layout: Layout;
  draft: Draft;
  /** Choices the user has struck out, as original option indexes. Kept for this sitting only, never sent. */
  struck: readonly number[];
  /** Words the user has highlighted. Kept for this sitting only, never sent. */
  marks: Marks;
  guessed: boolean;
  clientAttemptId: string;
  submitted: boolean;
  skipped: boolean;
}

/** Why the last request to end the exam did not land: no connection (tried again by itself), or the server's refusal. */
export type EndProblem = { kind: "offline" } | { kind: "refused"; message: string };

/**
 * Where the runner is. One value, so a state such as "saving and ending at once" cannot be written.
 * - answering: on a question not yet submitted (`index`). `returning` once every question was reached
 *   and the user is working back through skipped ones; `wrappedTo` is the question that wrap landed on.
 * - saving: that question's answer is on its way; `retrying` while the connection is down.
 * - ending: the request to end the exam is on its way. `problem` is the last failure, kept on screen.
 * - endPending: the user (or the clock, or the last answer) asked to end it, and the server has not
 *   confirmed. The screen offers one button that asks again; `retryInMs` asks again by itself.
 */
export type RunnerPhase =
  | { phase: "answering"; index: number; returning: boolean; wrappedTo: number | null; error: string | null }
  | { phase: "saving"; index: number; returning: boolean; wrappedTo: number | null; retrying: boolean }
  | { phase: "ending"; reason: ExamEndReason; problem: EndProblem | null; tries: number }
  | { phase: "endPending"; reason: ExamEndReason; problem: EndProblem | null; tries: number; retryInMs: number | null };

export type RunnerEvent =
  /** Submit the question on screen. Refused unless it has an answer and is not submitted. */
  | { type: "submit" }
  /** The answer's request failed on the network and is tried again. */
  | { type: "saveRetrying" }
  /** The server has the answer (or already had it). */
  | { type: "saved" }
  /** The server refused the answer, with its sentence. */
  | { type: "saveFailed"; message: string }
  /** The server says the exam has ended already: asking to end it returns it as it ended. */
  | { type: "examClosed" }
  | { type: "skip" }
  /** Change the question on screen. Refused on a submitted question and while anything is on its way. */
  | { type: "edit"; change: (item: ItemState) => Partial<Pick<ItemState, "draft" | "struck" | "marks" | "guessed">> }
  | { type: "end"; reason: ExamEndReason }
  | { type: "endFailed"; problem: EndProblem }
  /** Ask the server to end it again, from the button or the retry timer. */
  | { type: "retryEnd" }
  | { type: "tick"; secondsLeft: number };

export interface RunnerState {
  items: readonly ItemState[];
  phase: RunnerPhase;
}

/** The same steps as a dropped answer: 1, 2, 4, 8, then every 15 seconds. */
const FIRST_RETRY_MS = 1_000;
const LONGEST_RETRY_MS = 15_000;

export function endRetryDelay(tries: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, tries - 1), LONGEST_RETRY_MS);
}

/** Where to go after a question: the next one not yet submitted, wrapping back to skipped ones. */
export function nextStop(items: readonly ItemState[], from: number): { index: number; wrapped: boolean } | null {
  for (let index = from + 1; index < items.length; index += 1) {
    if (!items[index]?.submitted) return { index, wrapped: false };
  }
  for (let index = 0; index <= from && index < items.length; index += 1) {
    if (!items[index]?.submitted) return { index, wrapped: true };
  }
  return null;
}

/**
 * The first phase when the exam opens: its first question not yet submitted, or, when every
 * answer is in (a reload after the finish did not land), asking to finish it straight away.
 */
export function initialPhase(items: readonly ItemState[]): RunnerPhase {
  const first = nextStop(items, -1);
  // An exam with no questions has nothing to answer or finish: it only says so.
  if (first === null && items.length > 0) return { phase: "endPending", reason: "finished", problem: null, tries: 0, retryInMs: 0 };
  return { phase: "answering", index: first?.index ?? 0, returning: false, wrappedTo: null, error: null };
}

/** The phase after `event`, given the items as they are after it. Returns `state` itself when nothing changes. */
export function runnerStep(state: RunnerPhase, items: readonly ItemState[], event: RunnerEvent): RunnerPhase {
  switch (event.type) {
    case "submit": {
      if (state.phase !== "answering") return state;
      const item = items[state.index];
      if (!item || item.submitted || toResponse(item.draft) === null) return state;
      return { phase: "saving", index: state.index, returning: state.returning, wrappedTo: state.wrappedTo, retrying: false };
    }
    case "saveRetrying":
      return state.phase === "saving" && !state.retrying ? { ...state, retrying: true } : state;
    case "saved":
      return state.phase === "saving" ? moveOn(state, items) : state;
    case "saveFailed":
      if (state.phase !== "saving") return state;
      return { phase: "answering", index: state.index, returning: state.returning, wrappedTo: state.wrappedTo, error: event.message };
    case "examClosed":
      return state.phase === "saving" ? ending("finished") : state;
    case "skip":
      return state.phase === "answering" ? moveOn(state, items) : state;
    case "edit":
      return state;
    case "end":
      return state.phase === "answering" || state.phase === "saving" ? ending(event.reason) : state;
    case "endFailed": {
      if (state.phase !== "ending") return state;
      const tries = state.tries + 1;
      const retryInMs = event.problem.kind === "offline" ? endRetryDelay(tries) : null;
      return { phase: "endPending", reason: state.reason, problem: event.problem, tries, retryInMs };
    }
    case "retryEnd":
      return state.phase === "endPending" ? { phase: "ending", reason: state.reason, problem: state.problem, tries: state.tries } : state;
    case "tick":
      if (event.secondsLeft > 0) return state;
      return state.phase === "answering" || state.phase === "saving" ? ending("timeout") : state;
  }
}

/** The whole runner: the items change first (an edit, a skip, a saved answer), then the phase follows them. */
export function runnerReduce(state: RunnerState, event: RunnerEvent): RunnerState {
  const items = nextItems(state, event);
  const phase = runnerStep(state.phase, items, event);
  return items === state.items && phase === state.phase ? state : { items, phase };
}

function nextItems({ items, phase }: RunnerState, event: RunnerEvent): readonly ItemState[] {
  switch (event.type) {
    case "edit": {
      // Only the question being answered changes: never a submitted one, and nothing while an answer or the end is on its way.
      if (phase.phase !== "answering" || items[phase.index]?.submitted !== false) return items;
      return patch(items, phase.index, event.change);
    }
    case "saved":
      return phase.phase === "saving" ? patch(items, phase.index, () => ({ submitted: true, skipped: false })) : items;
    case "skip":
      return phase.phase === "answering" ? patch(items, phase.index, () => ({ skipped: true })) : items;
    default:
      return items;
  }
}

function patch(items: readonly ItemState[], index: number, change: (item: ItemState) => Partial<ItemState>): readonly ItemState[] {
  return items.map((item, position) => (position === index ? { ...item, ...change(item) } : item));
}

function ending(reason: ExamEndReason): RunnerPhase {
  return { phase: "ending", reason, problem: null, tries: 0 };
}

/** After a question is submitted or skipped: the next one not yet submitted, or, with none left, finishing the exam. */
function moveOn(state: { index: number; returning: boolean }, items: readonly ItemState[]): RunnerPhase {
  const stop = nextStop(items, state.index);
  if (stop === null) return ending("finished");
  return {
    phase: "answering",
    index: stop.index,
    returning: state.returning || stop.wrapped,
    wrappedTo: stop.wrapped ? stop.index : null,
    error: null,
  };
}

/** The progress strip of a timed exam: answered and skipped only, never right or wrong. */
export function examStrip(items: readonly ItemState[], current: number | null): StripStep[] {
  return items.map((item, index) => {
    if (item.submitted) return "answered";
    if (index === current) return "now";
    return item.skipped ? "skipped" : "todo";
  });
}
