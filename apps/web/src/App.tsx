import { useEffect, useLayoutEffect, useState } from "react";
import { bindSessionEnd } from "./api";
import { ApiError, readSession } from "./login/api";
import { ChoosePassword, LoginScreen } from "./login/LoginScreen";
import { AuthFrame } from "./login/ui";
import { SessionProvider } from "./login/session";
import { applySessionNotice, forgetThisDevice, type Gate } from "./session-end";
import { AppShell } from "./shell/AppShell";
import { forgetPalette, paletteOf, showPalette } from "./theme";

export function App() {
  const [gate, setGate] = useState<Gate>({ status: "loading" });

  useEffect(() => {
    if (gate.status === "unavailable") document.title = "Qbank";
  }, [gate.status]);

  // The account's color scheme, before the screen paints; Dusk when no one is signed in. While the
  // session is checked, the head script in index.html has already painted the last one used here.
  const palette = gate.status === "loading" ? undefined : "user" in gate ? paletteOf(gate.user.palette) : null;
  useLayoutEffect(() => {
    if (palette === undefined) return;
    if (palette === null) forgetPalette();
    else showPalette(palette);
  }, [palette]);

  // A session that ends mid-use, or a temporary password on any route, leaves the screen that was up.
  useEffect(() => bindSessionEnd((notice) => {
    applySessionNotice(notice, setGate);
  }), []);

  useEffect(() => {
    const controller = new AbortController();
    readSession(controller.signal)
      .then((user) => {
        if (!user) setGate({ status: "signed-out" });
        else if (user.mustChangePassword) setGate({ status: "must-change", user });
        else setGate({ status: "signed-in", user });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // Auth stays off until the server secret is set. The question screens stay closed.
        if (error instanceof ApiError && error.code === "auth_unavailable") {
          setGate({ status: "unavailable" });
          return;
        }
        console.error(error);
        setGate({ status: "signed-out" });
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (gate.status === "loading") {
    return (
      <main className="auth">
        <p className="auth-status" role="status">
          Checking the session...
        </p>
      </main>
    );
  }

  if (gate.status === "unavailable") {
    return (
      <AuthFrame title="Qbank" subtitle="Sign-in is not available right now." />
    );
  }

  if (gate.status === "signed-out") {
    return (
      <LoginScreen
        onSignedIn={(user) => {
          setGate(user.mustChangePassword ? { status: "must-change", user } : { status: "signed-in", user });
        }}
      />
    );
  }

  if (gate.status === "must-change") {
    return (
      <ChoosePassword
        onChosen={(user) => {
          setGate({ status: "signed-in", user });
        }}
      />
    );
  }

  const user = gate.user;
  return (
    <SessionProvider
      value={{
        user,
        // An account with a temporary password chooses a new one before anything else.
        replace: (next) => {
          setGate(next.mustChangePassword ? { status: "must-change", user: next } : { status: "signed-in", user: next });
        },
        // Nothing of this account stays on the screen for the next one on this device.
        signOut: () => {
          forgetThisDevice();
          setGate({ status: "signed-out" });
        },
      }}
    >
      <AppShell role={user.role} />
    </SessionProvider>
  );
}
