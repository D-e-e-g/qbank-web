import { ApiError, signOut, signOutEverywhere } from "./api";

/** Sign out ends this device's session. Sign out everywhere ends every session of the account, this one included. */
export type SignOutScope = "here" | "everywhere";

/**
 * Settings' two rows. Sign out is sent as soon as it is tapped; Sign out everywhere asks first, and
 * its words are the iPhone app's, word for word.
 */
export const SIGN_OUT_ROWS: Record<SignOutScope, { label: string; question: string | null }> = {
  here: { label: "Sign out", question: null },
  everywhere: { label: "Sign out everywhere", question: "Sign out of QBank on every device, including this one?" },
};

/** Said when the request never got an answer, so nothing is known to have ended. */
const NOT_SIGNED_OUT: Record<SignOutScope, string> = {
  here: "Signing out did not work. Try again.",
  everywhere: "Signing out everywhere did not work. Try again.",
};

export type SignOutOutcome =
  /** The server ended the session (every session of the account, for everywhere), or it had already ended: sign-in shows. */
  | { kind: "signed-out" }
  /** No session ended, and the account stays signed in: the sentence to show. */
  | { kind: "refused"; message: string };

/**
 * Asks the server to end this session, or every session of the account, and says how it went. The
 * session is a cookie this page can neither read nor clear, so only the server's answer ends it:
 * the screen shows sign-in for `signed-out` and for nothing else.
 */
export async function requestSignOut(scope: SignOutScope): Promise<SignOutOutcome> {
  try {
    await (scope === "here" ? signOut() : signOutEverywhere());
    return { kind: "signed-out" };
  } catch (caught) {
    // A dropped connection: if it reached the server anyway, the next request answers unauthenticated.
    if (!(caught instanceof ApiError)) return { kind: "refused", message: NOT_SIGNED_OUT[scope] };
    if (caught.code === "unauthenticated") return { kind: "signed-out" };
    return { kind: "refused", message: caught.message };
  }
}
