import { ApiError, api } from "./api";
import type { components } from "./api-schema";

export interface AttemptSubmission {
  /** Made once per answer with newAttemptId(). Every retry of that answer sends the same id. */
  clientAttemptId: string;
  questionId: string;
  /** Checked by the server, which refuses an answer the question cannot take with its reason. */
  response: components["schemas"]["Answer"];
  guessed?: boolean;
  shuffle?: unknown;
  /** The running exam this answer belongs to. */
  studySessionId?: string;
  /** Sent by the Review runner only. The server files every other answer in its set's sitting by itself. */
  fromReview?: boolean;
}

/** What the server scored and saved, with the feedback banner's text for it. */
export type SavedAttempt = components["schemas"]["SavedAttempt"];

export interface SubmitOptions {
  /** Stops retrying, for example when she leaves the question. The promise rejects with the abort reason. */
  signal?: AbortSignal;
  /** Called each time a try fails on the network, before the next one. */
  onRetry?: () => void;
}

const FIRST_DELAY_MS = 1_000;
const LONGEST_DELAY_MS = 15_000;

export function newAttemptId(): string {
  return crypto.randomUUID();
}

/**
 * Posts one answer and returns what the server scored and saved. A dropped connection is
 * retried with the same clientAttemptId until the server answers, so an answer that reached
 * the server before the connection dropped is returned, not counted twice.
 */
export async function submitAttempt(input: AttemptSubmission, options: SubmitOptions = {}): Promise<SavedAttempt> {
  let delay = FIRST_DELAY_MS;
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      return await api<SavedAttempt>("/api/attempts", { method: "POST", json: input });
    } catch (caught) {
      if (!isTransient(caught)) throw caught;
    }
    options.onRetry?.();
    await waitToRetry(delay, options.signal);
    delay = Math.min(delay * 2, LONGEST_DELAY_MS);
  }
}

/** A failed fetch, a cut-off response, or a server that is restarting. A refusal is final. */
export function isTransient(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 502 || error.status === 504) return true;
    // The API answers 503 on its own only when sign-in is not set up, which a retry cannot fix.
    return error.status === 503 && !hasErrorCode(error.body);
  }
  return error instanceof TypeError || error instanceof SyntaxError;
}

function hasErrorCode(body: unknown): boolean {
  return typeof body === "object" && body !== null && "error" in body;
}

/** Waits for the delay, or for the device to come back online, whichever is first. */
function waitToRetry(delay: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(done, delay);
    window.addEventListener("online", done);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
