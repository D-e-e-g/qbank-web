import { NEW_RUN_NOTICE, showNewRunNotice } from "./new-run";
import type { Session } from "./session";

/** A plain note above question 1. It has nothing to tap and does not block answering. */
export function NewRunNotice({ session }: { session: Pick<Session, "kind" | "index" | "finishedAt" | "newRun"> }) {
  if (!showNewRunNotice(session)) return null;
  return <p className="runner-new-run">{NEW_RUN_NOTICE}</p>;
}
