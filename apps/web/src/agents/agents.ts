import { api, ApiError } from "../api";
import type { components } from "../api-schema";
import { when } from "../when";

type Schemas = components["schemas"];

/** An agent waiting under a user code: the name it gave and what its key would be able to do. */
export type AgentPairing = Schemas["AgentPairing"];
/** One of the account's agent keys, as listed: never the key itself. */
export type AgentKey = Schemas["AgentKey"];
export type AgentScope = Schemas["AgentScope"];

/** Where Settings opens Connect an agent. `?code=` fills in the code an agent sent, for the user to confirm. */
export const AGENTS_PATH = "/settings/agents";

/** The code as the user typed or pasted it, trimmed and in capitals; the server takes any case, with or without its dash. */
export function cleanCode(input: string): string {
  return input.trim().toUpperCase();
}

/** The code an address carries in `?code=`, or "" without one. */
export function codeFromSearch(search: string): string {
  return cleanCode(new URLSearchParams(search).get("code") ?? "");
}

/** An agent key reaches its own account's content, and the admin's session only views: what it asks for reaches nothing. */
export const ADMIN_KEY = "An agent key reaches only its own account's content, and the admin account has none. QBank refuses this key every time.";

/** What a scope lets an agent do, in plain words, for the approval screen, when the server has not described it. */
export function scopeWords(scope: string, admin: boolean): { title: string; detail: string } {
  if (scope === "import") {
    return {
      title: "Import question sets",
      detail: admin ? ADMIN_KEY : "Into the courses and topics of your account, reading them to file each set. It never replaces, moves, renames, or deletes a set.",
    };
  }
  if (scope === "read") {
    return {
      title: "Read progress, read-only",
      detail: admin ? ADMIN_KEY : "Where you stand by topic, your Review lists, your exams, and your progress export. It changes nothing.",
    };
  }
  if (scope === "manage") {
    return {
      title: admin ? "Add, change, and delete content" : "Add, change, and delete your content",
      detail: admin
        ? ADMIN_KEY
        : "The sets, questions, folders, courses, and topics of your account, as you can in QBank. Anything it deletes goes to Recently deleted, where Undo brings it back for 30 days.",
    };
  }
  // A scope added after this screen was made: shown by its name, as the contract asks.
  return { title: scope, detail: "QBank has not described this one here yet." };
}

/** The scope that reaches the most: an agent with it adds, changes, and deletes her content. */
export function isStrongest(scope: string): boolean {
  return scope === "manage";
}

/** Each scope a pairing asks for, in its order: a short title, and the server's plain words when it sent them. */
export function pairingScopes(pairing: AgentPairing, admin: boolean): { scope: string; title: string; detail: string; strongest: boolean }[] {
  return pairing.scopes.map((scope) => {
    const words = scopeWords(scope, admin);
    // The server's plain words are about the user's own content, so the admin reads its own.
    const text = admin ? undefined : pairing.scopeTexts.find((described) => described.scope === scope)?.text;
    return { scope, title: words.title, detail: text ?? words.detail, strongest: isStrongest(scope) };
  });
}

/** What the key never does, under what it asks to do: deleting only when it asks to manage, and then with Undo. */
export function approvalNote(scopes: readonly string[]): string {
  const ask = "Approve only a code your own agent is showing you now.";
  if (scopes.includes("manage")) {
    return `${ask} Its key never answers questions for you, changes a password, or reaches your other keys, and what it deletes goes to Recently deleted.`;
  }
  return `${ask} Its key never changes a password, deletes anything, or reaches your other keys.`;
}

const MANAGE_VERB = "add, change, and delete your sets, questions, folders, courses, and topics";

/**
 * "Can import sets", "Can import sets and read progress": a key's scopes in a few words, for its row. Manage
 * reaches everything import does, so a key with it says what it changes, and where what it deletes goes.
 */
export function scopesLine(scopes: readonly string[]): string {
  const manage = scopes.includes("manage");
  const verbs = scopes
    .filter((scope) => scope !== "manage" && !(manage && scope === "import"))
    .map((scope) => (scope === "import" ? "import sets" : scope === "read" ? "read progress" : scope));
  if (manage) {
    const others = verbs.length === 0 ? "" : `${listed(verbs)}, and `;
    return `Can ${others}${MANAGE_VERB}. What it deletes goes to Recently deleted.`;
  }
  if (verbs.length === 0) return "Can do nothing";
  return `Can ${listed(verbs)}`;
}

function listed(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

/** What revoking a key leaves behind: what it imported, and for a key that manages, what it changed and deleted. */
export function revokeMessage(scopes: readonly string[]): string {
  const left = scopes.includes("manage")
    ? "What it imported or changed stays as it is, and what it deleted stays in Recently deleted."
    : "The sets it imported stay where they are.";
  return `Its key stops working at once and for good. ${left} To connect this agent again, approve a new code from it.`;
}

/** "Made Oct 25 · Last used today", "Made today · Never used", or "Made Oct 25 · Revoked Oct 26". */
export function keyDates(key: AgentKey): string {
  const made = `Made ${when(key.createdAt)}`;
  if (key.revokedAt !== null) return `${made} · Revoked ${when(key.revokedAt)}`;
  return `${made} · ${key.lastUsedAt === null ? "Never used" : `Last used ${when(key.lastUsedAt)}`}`;
}

/** "4:12 PM": when a code stops working, in the device's locale. */
export function codeEnds(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** What went wrong, as the server says it, or the fallback when it said nothing usable. */
export function refusal(caught: unknown, fallback: string): string {
  return caught instanceof ApiError && caught.body !== null ? caught.message : fallback;
}

export function lookupPairing(userCode: string): Promise<AgentPairing> {
  return api<AgentPairing>("/api/agent-pairings/lookup", { method: "POST", json: { userCode } });
}

export function answerPairing(userCode: string, answer: "approve" | "deny"): Promise<AgentPairing> {
  return api<AgentPairing>(`/api/agent-pairings/${answer}`, { method: "POST", json: { userCode } });
}

export async function listAgentKeys(): Promise<AgentKey[]> {
  return (await api<Schemas["AgentKeyList"]>("/api/agent-keys")).keys;
}

export function revokeAgentKey(id: string): Promise<AgentKey> {
  return api<AgentKey>(`/api/agent-keys/${encodeURIComponent(id)}/revoke`, { method: "POST" });
}
