import { useState } from "react";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { requestSignOut, SIGN_OUT_ROWS, type SignOutScope } from "./sign-out";
import { Button } from "./ui";

/** Where a row is: at rest, asking its question, waiting for the server, or showing why it was refused. */
type RowState = { kind: "idle" } | { kind: "asking" } | { kind: "sending" } | { kind: "refused"; message: string };

/**
 * Settings' Sign out and Sign out everywhere. Sign out everywhere asks once first. Sign-in shows
 * only once the server has ended the session, or says it had already ended. A refusal ends
 * nothing: the account stays signed in, and the row says why under its button.
 */
export function SignOutRow({ scope, onSignedOut }: { scope: SignOutScope; onSignedOut: () => void }) {
  const row = SIGN_OUT_ROWS[scope];
  const [state, setState] = useState<RowState>({ kind: "idle" });

  const send = () => {
    setState({ kind: "sending" });
    void requestSignOut(scope).then((outcome) => {
      if (outcome.kind === "signed-out") onSignedOut();
      else setState(outcome);
    });
  };

  return (
    <>
      <Button
        variant="quiet"
        size="md"
        icon="log-out"
        disabled={state.kind === "sending"}
        onClick={() => {
          if (row.question === null) send();
          else setState({ kind: "asking" });
        }}
      >
        {row.label}
      </Button>
      {state.kind === "refused" ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.kind === "asking" && row.question !== null ? (
        <ConfirmSheet
          title={row.question}
          confirmLabel={row.label}
          confirmVariant="destructive"
          onConfirm={send}
          onCancel={() => {
            setState({ kind: "idle" });
          }}
        />
      ) : null}
    </>
  );
}
