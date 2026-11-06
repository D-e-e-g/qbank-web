import { useEffect, useState } from "react";
import {
  ADMIN_KEY,
  AGENTS_PATH,
  answerPairing,
  approvalNote,
  cleanCode,
  codeEnds,
  codeFromSearch,
  keyDates,
  listAgentKeys,
  lookupPairing,
  pairingScopes,
  refusal,
  revokeAgentKey,
  revokeMessage,
  scopesLine,
  type AgentKey,
  type AgentPairing,
} from "../agents/agents";
import { Button } from "../components/Button";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { TextField } from "../login/ui";
import { useSession } from "../login/session-context";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";

type Stage =
  | { kind: "enter" }
  | { kind: "found"; code: string; pairing: AgentPairing }
  | { kind: "answered"; approved: boolean; name: string };

/** After an approval the agent picks its key up on its next poll; the list is read again until it shows. */
const PICKUP_POLL_MS = 4000;
const PICKUP_POLLS = 30;

/**
 * Connect an agent, from Settings › Account: the user enters (or confirms) the short code their agent
 * shows, sees the agent's name and what it asks to do, and approves or denies it. No key is ever shown
 * or copied: the agent picks its own up. Under it, Your keys lists the account's keys, each revocable.
 */
export function AgentsScreen() {
  const admin = useSession().user.role === "admin";
  // A code an agent sent in the address (?code=) is filled in and looked up, for the user to confirm.
  const [sent] = useState(() => codeFromSearch(window.location.search));
  const [code, setCode] = useState(sent);
  const [stage, setStage] = useState<Stage>({ kind: "enter" });
  const [busy, setBusy] = useState(sent !== "");
  const [error, setError] = useState<string | undefined>();
  const [keys, setKeys] = useState<AgentKey[] | null>(null);
  const [keysError, setKeysError] = useState<string | undefined>();
  // After an approval: the keys known then, until a new one shows or the polls run out.
  const [watching, setWatching] = useState<ReadonlySet<string> | null>(null);
  const [revoking, setRevoking] = useState<AgentKey | null>(null);
  const [revoked, setRevoked] = useState<string | undefined>();

  const lookUp = (typed: string) => {
    const userCode = cleanCode(typed);
    if (userCode === "") {
      setError("Enter the code your agent shows you.");
      return;
    }
    setBusy(true);
    setError(undefined);
    lookupPairing(userCode)
      .then((pairing) => {
        setStage({ kind: "found", code: userCode, pairing });
      })
      .catch((caught: unknown) => {
        setError(refusal(caught, "That code could not be checked. Try again."));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const answer = (found: Extract<Stage, { kind: "found" }>, approve: boolean) => {
    setBusy(true);
    setError(undefined);
    answerPairing(found.code, approve ? "approve" : "deny")
      .then((pairing) => {
        setCode("");
        setStage({ kind: "answered", approved: approve, name: pairing.name });
        if (approve) setWatching(new Set((keys ?? []).map((key) => key.id)));
      })
      .catch((caught: unknown) => {
        // Run out or answered elsewhere meanwhile: back to the code, with the server's reason.
        setStage({ kind: "enter" });
        setError(refusal(caught, "That answer was not saved. Try again."));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  useEffect(() => {
    if (sent === "") return;
    // The code is in the field now; a reload should not look up a code that was answered already.
    window.history.replaceState(null, "", AGENTS_PATH);
    let cancel = false;
    lookupPairing(sent)
      .then((pairing) => {
        if (!cancel) setStage({ kind: "found", code: sent, pairing });
      })
      .catch((caught: unknown) => {
        if (!cancel) setError(refusal(caught, "That code could not be checked. Try again."));
      })
      .finally(() => {
        if (!cancel) setBusy(false);
      });
    return () => {
      cancel = true;
    };
  }, [sent]);

  useEffect(() => {
    let cancel = false;
    listAgentKeys().then(
      (rows) => {
        if (!cancel) setKeys(rows);
      },
      (caught: unknown) => {
        if (!cancel) setKeysError(refusal(caught, "Your keys could not be loaded."));
      },
    );
    return () => {
      cancel = true;
    };
  }, []);

  // The agent picks its key up on its next poll, and only then is it listed: read the list again until it shows.
  useEffect(() => {
    if (watching === null) return;
    let cancel = false;
    let left = PICKUP_POLLS;
    const timer = window.setInterval(() => {
      left -= 1;
      listAgentKeys().then(
        (rows) => {
          if (cancel) return;
          setKeys(rows);
          setKeysError(undefined);
          if (left <= 0 || rows.some((row) => !watching.has(row.id))) setWatching(null);
        },
        () => {
          if (!cancel && left <= 0) setWatching(null);
        },
      );
    }, PICKUP_POLL_MS);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [watching]);

  const confirmRevoke = () => {
    if (revoking === null) return;
    const key = revoking;
    setRevoking(null);
    setRevoked(undefined);
    setKeysError(undefined);
    revokeAgentKey(key.id)
      .then((row) => {
        setKeys((rows) => rows?.map((old) => (old.id === row.id ? row : old)) ?? [row]);
        setRevoked(`Revoked ${key.name}. It stopped working just now.`);
      })
      .catch((caught: unknown) => {
        setKeysError(refusal(caught, "That key could not be revoked. Try again."));
      });
  };

  return (
    <Screen title="Connect an agent">
      <ShellLink to="/settings" className="text-action" current={false}>
        Settings
      </ShellLink>
      <p className="note">
        Your agent shows you a short code. Enter it here to see what the agent asks to do, then approve or deny it. You never see or copy a key: the agent
        picks its own up.
      </p>
      <section className="group">
        <h2 className="group-header">Approve a code</h2>
        <div className="group-card auth-stack">
          {stage.kind === "found" ? (
            <PairingRequest
              code={stage.code}
              pairing={stage.pairing}
              admin={admin}
              busy={busy}
              onApprove={() => {
                answer(stage, true);
              }}
              onDeny={() => {
                answer(stage, false);
              }}
            />
          ) : (
            <>
              {stage.kind === "answered" ? (
                <p className="status-banner" role="status">
                  <Icon name={stage.approved ? "check" : "x"} size={16} strokeWidth={2} />
                  <span>
                    {stage.approved
                      ? `Approved ${stage.name}. It picks up its key within a few seconds, and then it shows under Your keys.`
                      : `Denied ${stage.name}. No key was made.`}
                  </span>
                </p>
              ) : null}
              <form
                className="auth-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  lookUp(code);
                }}
              >
                <TextField
                  id="agent-code"
                  label="Code"
                  value={code}
                  onChange={(next) => {
                    setCode(next);
                    setError(undefined);
                  }}
                  autoComplete="off"
                  autoCapitalize="characters"
                  // A non-breaking hyphen, so the example code never splits across lines.
                  hint="The code your agent shows you, such as BCDF‑GHJK. It lasts 10 minutes."
                />
                <Button type="submit" disabled={busy}>
                  Continue
                </Button>
              </form>
            </>
          )}
          {error !== undefined ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>
      <section className="group">
        <h2 className="group-header">Your keys</h2>
        {revoked !== undefined ? (
          <p className="status-banner" role="status">
            <Icon name="check" size={16} strokeWidth={2} />
            <span>{revoked}</span>
          </p>
        ) : null}
        {keysError !== undefined ? (
          <p className="form-error" role="alert">
            {keysError}
          </p>
        ) : null}
        {keys === null ? (
          keysError === undefined ? (
            <p className="note">Loading your keys.</p>
          ) : null
        ) : keys.length === 0 ? (
          <div className="empty-card">
            <EmptyState icon="key-round" message="No agent keys yet. When you approve an agent, its key shows here." />
          </div>
        ) : (
          <ul className="list-group list-group-sets" aria-label="Your agent keys">
            {keys.map((key) => (
              <li key={key.id}>
                <div className={key.revokedAt === null ? "list-row" : "list-row agent-key-revoked"}>
                  <span className="list-copy">
                    <span className="list-title list-title-strong agent-tagged">
                      <span>{key.name}</span>
                      {key.revokedAt === null && key.scopes.includes("manage") ? <MostAccess /> : null}
                    </span>
                    <span className="list-meta">{keyDates(key)}</span>
                    <span className="list-meta">{key.revokedAt !== null ? "Revoked: it never works again" : admin ? ADMIN_KEY : scopesLine(key.scopes)}</span>
                  </span>
                  {key.revokedAt === null ? (
                    <Button
                      variant="destructive"
                      className="row-delete"
                      aria-label={`Revoke ${key.name}`}
                      onClick={() => {
                        setRevoked(undefined);
                        setRevoking(key);
                      }}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="group-footer">
          Each key works for this account only, and only for what it was approved to do. Revoking one stops it at once; what it imported or changed stays as
          it is.
        </p>
      </section>
      {revoking !== null ? (
        <ConfirmSheet
          title={`Revoke ${revoking.name}?`}
          message={revokeMessage(revoking.scopes)}
          confirmLabel="Revoke"
          confirmVariant="destructive"
          onConfirm={confirmRevoke}
          onCancel={() => {
            setRevoking(null);
          }}
        />
      ) : null}
    </Screen>
  );
}

/** The agent waiting under the code: its name, what it asks to do, and Approve or Deny. */
function PairingRequest({
  code,
  pairing,
  admin,
  busy,
  onApprove,
  onDeny,
}: {
  code: string;
  pairing: AgentPairing;
  admin: boolean;
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="auth-stack" role="group" aria-label={`${pairing.name} asks to connect`}>
      <div className="agent-request">
        <span className="agent-request-name">{pairing.name}</span>
        <span className="agent-request-code">
          Code {code} · Works until {codeEnds(pairing.expiresAt)}
        </span>
      </div>
      <div className="agent-scopes">
        <span className="field-label">It asks to</span>
        <ul className="agent-scope-list">
          {pairingScopes(pairing, admin).map((scope) => (
            <li key={scope.scope} className="agent-scope">
              <span className="row-icon">
                <Icon name="check" size={18} strokeWidth={2} />
              </span>
              <span className="list-copy">
                <span className="list-title agent-tagged">
                  <span>{scope.title}</span>
                  {scope.strongest ? <MostAccess /> : null}
                </span>
                <span className="list-meta">{scope.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="form-note">{approvalNote(pairing.scopes)}</p>
      <div className="agent-answer">
        <Button variant="secondary" disabled={busy} onClick={onDeny}>
          Deny
        </Button>
        <Button disabled={busy} onClick={onApprove}>
          Approve
        </Button>
      </div>
    </div>
  );
}

/** Marks the scope that reaches the most, calmly: a tag beside its title, never a warning. */
function MostAccess() {
  return <span className="agent-scope-tag">Most access</span>;
}
