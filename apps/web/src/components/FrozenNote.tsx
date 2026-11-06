import { dismissFrozen, useFrozenNotice } from "../frozen";
import { Notice } from "./Notice";

/** The card a frozen control answers with, over whichever screen is open, so nothing on it moves. */
export function FrozenNote() {
  return <Notice notice={useFrozenNotice()} onDismiss={dismissFrozen} />;
}
