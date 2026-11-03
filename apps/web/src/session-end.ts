import type { SessionNotice } from "./api";
import { forgetCatalog } from "./catalog";
import { forgetUndo } from "./course/deletion";
import type { Account } from "./login/api";
import { navigate } from "./router";
import { forgetStudents } from "./students";

export type Gate =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "signed-out" }
  | { status: "must-change"; user: Account }
  | { status: "signed-in"; user: Account };

/** Drops this account's lists and returns home, as sign-out does, without calling the server. */
export function forgetThisDevice(): void {
  forgetStudents();
  forgetCatalog();
  forgetUndo();
  navigate("/");
}

/** The next gate after the shared api() path reports a dead session or a temporary password. */
export function gateAfterNotice(gate: Gate, notice: SessionNotice): Gate {
  if (notice.kind === "signed-out") return { status: "signed-out" };
  if (gate.status === "signed-in" || gate.status === "must-change") return { status: "must-change", user: gate.user };
  return gate;
}

/**
 * A dead session clears this device and shows sign-in. A temporary password keeps what is on screen
 * and shows the change-password step. The signed-in app is the only caller, from the one api() path.
 */
export function applySessionNotice(notice: SessionNotice, setGate: (update: (gate: Gate) => Gate) => void): void {
  if (notice.kind === "signed-out") forgetThisDevice();
  setGate((gate) => gateAfterNotice(gate, notice));
}
