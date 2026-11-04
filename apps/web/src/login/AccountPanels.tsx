import { useState } from "react";
import { AGENTS_PATH } from "../agents/agents";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { Icon } from "../components/Icon";
import { ShellLink } from "../shell/ShellLink";
import { ApiError, changePassword, setTemporaryPassword, signOut, type Account } from "./api";
import { DeleteAccountSheet } from "./DeleteAccountSheet";
import { isDeleteOffered } from "./delete-account";
import { requestSignOutEverywhere, SIGN_OUT_EVERYWHERE, SIGN_OUT_EVERYWHERE_QUESTION } from "./sign-out-everywhere";
import { Button, TextField } from "./ui";

export function AccountSection({ user, onUser, onSignedOut }: { user: Account; onUser: (user: Account) => void; onSignedOut: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <section className="group">
      <h2 className="group-header">Account</h2>
      <div className="group-card auth-stack">
        <p className="form-note">Signed in as {user.email}.</p>
        <form
          className="auth-stack"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(undefined);
            setMessage(undefined);
            void changePassword(currentPassword, newPassword)
              .then((next) => {
                onUser(next);
                setCurrentPassword("");
                setNewPassword("");
                setMessage("Password saved.");
              })
              .catch((caught: unknown) => {
                setError(caught instanceof ApiError ? caught.message : "The password could not be changed.");
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <TextField
            id="settings-current-password"
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
          />
          <TextField
            id="settings-new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={setNewPassword}
          />
          <Button type="submit" size="md" disabled={busy}>
            Change password
          </Button>
        </form>
        {message !== undefined ? <p className="form-note">{message}</p> : null}
        {error !== undefined ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <ShellLink to={AGENTS_PATH} className="account-link" current={false}>
          <span className="row-icon">
            <Icon name="link-2" size={20} />
          </span>
          <span className="list-copy">
            <span className="list-title">Connect an agent</span>
            <span className="list-meta">Approve its code, and see your keys</span>
          </span>
          <span className="list-chevron">
            <Icon name="chevron-right" size={18} strokeWidth={2} />
          </span>
        </ShellLink>
        <Button
          variant="quiet"
          size="md"
          icon="log-out"
          onClick={() => {
            void signOut().finally(onSignedOut);
          }}
        >
          Sign out
        </Button>
        <SignOutEverywhere onSignedOut={onSignedOut} />
        {isDeleteOffered(user) ? (
          <Button
            variant="destructive"
            size="md"
            icon="trash-2"
            onClick={() => {
              setDeleting(true);
            }}
          >
            Delete account
          </Button>
        ) : null}
      </div>
      {deleting ? (
        <DeleteAccountSheet
          email={user.email}
          onDone={(outcome) => {
            if (outcome.kind === "deleted") {
              // The server ended its sessions and cleared this device's cookie; the rest goes as a sign-out's does.
              onSignedOut();
            } else if (outcome.kind === "signed-out") {
              void signOut().finally(onSignedOut);
            } else {
              onUser({ ...user, mustChangePassword: true });
            }
          }}
          onClose={() => {
            setDeleting(false);
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Ends every session of the account, on every device, this one included, after asking once. Once
 * they have ended, sign-in shows, as after Sign out. A refusal ends nothing and keeps her signed in,
 * in the server's words.
 */
function SignOutEverywhere({ onSignedOut }: { onSignedOut: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  return (
    <>
      <Button
        variant="quiet"
        size="md"
        icon="log-out"
        disabled={busy}
        onClick={() => {
          setAsking(true);
        }}
      >
        {SIGN_OUT_EVERYWHERE}
      </Button>
      {error !== undefined ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {asking ? (
        <ConfirmSheet
          title={SIGN_OUT_EVERYWHERE_QUESTION}
          confirmLabel={SIGN_OUT_EVERYWHERE}
          confirmVariant="destructive"
          onConfirm={() => {
            setAsking(false);
            setBusy(true);
            setError(undefined);
            void requestSignOutEverywhere().then((outcome) => {
              if (outcome.kind === "signed-out") {
                onSignedOut();
                return;
              }
              setBusy(false);
              setError(outcome.message);
            });
          }}
          onCancel={() => {
            setAsking(false);
          }}
        />
      ) : null}
    </>
  );
}

/** The admin sets a temporary password for the student he is looking at. */
export function StudentPassword({ email }: { email: string }) {
  const [temporaryPassword, setTemporary] = useState("");
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="auth-stack"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);
        setMessage(undefined);
        void setTemporaryPassword(temporaryPassword)
          .then((reset) => {
            setTemporary("");
            setMessage(`Temporary password set for ${reset}. She'll choose her own the next time she signs in.`);
          })
          .catch((caught: unknown) => {
            setError(caught instanceof ApiError ? caught.message : "The temporary password could not be set.");
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <TextField
        id="temporary-password"
        label="Temporary password"
        type="text"
        autoComplete="off"
        value={temporaryPassword}
        onChange={setTemporary}
        hint={`For ${email}. Give it to her yourself. She'll choose her own the next time she signs in.`}
      />
      <Button type="submit" variant="secondary" icon="lock" disabled={busy}>
        Set temporary password
      </Button>
      {message !== undefined ? <p className="form-note">{message}</p> : null}
      {error !== undefined ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
