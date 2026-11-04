import { ApiError, signOutEverywhere } from "./api";

/** Settings' row and its question, word for word as the iPhone app has them. */
export const SIGN_OUT_EVERYWHERE = "Sign out everywhere";
export const SIGN_OUT_EVERYWHERE_QUESTION = "Sign out of QBank on every device, including this one?";

const NOT_SIGNED_OUT = "Signing out everywhere did not work. Try again.";

export type SignOutEverywhereOutcome =
  /** Every session of the account has ended, this one included, or this one already had: sign-in shows, as after Sign out. */
  | { kind: "signed-out" }
  /** No session ended, and she stays signed in: the sentence to show. */
  | { kind: "refused"; message: string };

/** Asks the server to end every session of the signed-in account, and says how it went. */
export async function requestSignOutEverywhere(): Promise<SignOutEverywhereOutcome> {
  try {
    await signOutEverywhere();
    return { kind: "signed-out" };
  } catch (caught) {
    // A dropped connection: if it reached the server anyway, the next request answers unauthenticated.
    if (!(caught instanceof ApiError)) return { kind: "refused", message: NOT_SIGNED_OUT };
    if (caught.code === "unauthenticated") return { kind: "signed-out" };
    return { kind: "refused", message: caught.message };
  }
}
