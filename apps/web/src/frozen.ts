import { useSyncExternalStore } from "react";
import { bindFrozenNote } from "./api";
import type { NoticeMessage } from "./components/Notice";
import { useSession } from "./login/session-context";
import { viewedEmail } from "./students";

/**
 * The admin's frozen view of a user account: every screen renders as that user sees it, and each
 * control that would change something says this one note and sends nothing. The iPhone says the same.
 */
export function frozenNote(email: string | null): string {
  return `This is a frozen view of ${email ?? "a user account"}. Nothing here can be changed.`;
}

// The server's refusal is the backstop, and says the same note where a screen shows a refusal.
bindFrozenNote(() => frozenNote(viewedEmail()));

const listeners = new Set<() => void>();
let shown: NoticeMessage | null = null;
let said = 0;

function publish(next: NoticeMessage | null): void {
  shown = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Says the note. Saying it again starts its time over. */
export function sayFrozen(): void {
  said += 1;
  publish({ id: said, text: frozenNote(viewedEmail()), icon: "eye" });
}

export function dismissFrozen(id: number): void {
  if (shown?.id === id) publish(null);
}

/** The note on screen, for the one card that shows it (FrozenNote). */
export function useFrozenNotice(): NoticeMessage | null {
  return useSyncExternalStore(subscribe, () => shown, () => shown);
}

/**
 * `guard` wraps what a control does when it would change something: for the user it is that action,
 * and in the frozen view it says the note instead. Opening and reading are not guarded.
 */
export function useFrozen(): { frozen: boolean; guard: <Args extends unknown[]>(action: (...args: Args) => void) => (...args: Args) => void } {
  const frozen = useSession().user.role === "admin";
  return { frozen, guard: (action) => (frozen ? sayFrozen : action) };
}
