import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import {
  AGENTS_PATH,
  approvalNote,
  cleanCode,
  codeFromSearch,
  isStrongest,
  keyDates,
  pairingScopes,
  refusal,
  revokeMessage,
  scopesLine,
  scopeWords,
  type AgentKey,
  type AgentPairing,
} from "./agents";

function key(overrides: Partial<AgentKey> = {}): AgentKey {
  return {
    id: "74b9a6cf-4cdf-49ee-a9d8-d8184f6619ee",
    name: "My MacBook agent",
    scopes: ["import"],
    createdAt: "2026-03-02T15:00:00Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function pairing(overrides: Partial<AgentPairing> = {}): AgentPairing {
  return {
    name: "My MacBook agent",
    scopes: ["import", "manage"],
    scopeTexts: [
      { scope: "import", text: "Import question sets into your courses and topics." },
      { scope: "manage", text: "Add, change and delete your courses, topics, folders and sets. Anything it deletes goes to Recently deleted." },
    ],
    status: "pending",
    createdAt: "2026-03-02T15:00:00Z",
    expiresAt: "2026-03-02T15:10:00Z",
    ...overrides,
  };
}

describe("the code an agent shows", () => {
  it("is trimmed and put in capitals, with its dash or without", () => {
    expect(cleanCode("  bcdf-ghjk \n")).toBe("BCDF-GHJK");
    expect(cleanCode("bcdfghjk")).toBe("BCDFGHJK");
    expect(cleanCode("   ")).toBe("");
  });

  it("can come in the address, for the user to confirm", () => {
    expect(codeFromSearch("?code=bcdf-ghjk")).toBe("BCDF-GHJK");
    expect(codeFromSearch("?other=1")).toBe("");
    expect(codeFromSearch("")).toBe("");
    expect(AGENTS_PATH).toBe("/settings/agents");
  });
});

describe("what an agent asks to do", () => {
  it("says import in plain words, and that a key never replaces or deletes a set", () => {
    const words = scopeWords("import", false);
    expect(words.title).toBe("Import question sets");
    expect(words.detail).toContain("your account");
    expect(words.detail).toContain("never replaces, moves, renames, or deletes a set");
  });

  it("says a key the admin approves reaches nothing, whatever it asks for", () => {
    for (const scope of ["import", "read", "manage"]) {
      expect(scopeWords(scope, true).detail).toBe("An agent key reaches only its own account's content, and the admin account has none. QBank refuses this key every time.");
    }
  });

  it("says read is read-only", () => {
    const words = scopeWords("read", false);
    expect(words.title).toBe("Read progress, read-only");
    expect(words.detail).toContain("It changes nothing.");
  });

  it("says manage adds, changes, and deletes her content, every delete to Recently deleted", () => {
    const words = scopeWords("manage", false);
    expect(words.title).toBe("Add, change, and delete your content");
    expect(words.detail).toContain("sets, questions, folders, courses, and topics of your account");
    expect(words.detail).toContain("goes to Recently deleted");
  });

  it("marks only manage as the scope that reaches the most", () => {
    expect(isStrongest("manage")).toBe(true);
    expect(isStrongest("import")).toBe(false);
    expect(isStrongest("read")).toBe(false);
  });

  it("shows the server's plain words for each scope, in its order, under a short title", () => {
    expect(pairingScopes(pairing(), false)).toEqual([
      { scope: "import", title: "Import question sets", detail: "Import question sets into your courses and topics.", strongest: false },
      {
        scope: "manage",
        title: "Add, change, and delete your content",
        detail: "Add, change and delete your courses, topics, folders and sets. Anything it deletes goes to Recently deleted.",
        strongest: true,
      },
    ]);
  });

  it("falls back to its own words only for a scope the server did not describe", () => {
    const [imported, read] = pairingScopes(pairing({ scopes: ["import", "read"], scopeTexts: [{ scope: "import", text: "Server words." }] }), false);
    expect(imported?.detail).toBe("Server words.");
    expect(read?.detail).toBe(scopeWords("read", false).detail);
  });

  it("says a key never deletes, unless it asks to manage, and then that deletes go to Recently deleted", () => {
    expect(approvalNote(["import", "read"])).toContain("never changes a password, deletes anything, or reaches your other keys");
    const manage = approvalNote(["import", "manage"]);
    expect(manage).not.toContain("deletes anything");
    expect(manage).toContain("never answers questions for you");
    expect(manage).toContain("what it deletes goes to Recently deleted");
  });

  it("shows a scope it does not know by its name", () => {
    expect(scopeWords("export", false).title).toBe("export");
  });

  it("never says Firstmate", () => {
    for (const scope of ["import", "read", "manage", "export"]) {
      for (const admin of [false, true]) expect(JSON.stringify(scopeWords(scope, admin))).not.toMatch(/firstmate/i);
    }
  });
});

describe("a key's row", () => {
  it("lists its scopes in a few words", () => {
    expect(scopesLine(["import"])).toBe("Can import sets");
    expect(scopesLine(["import", "read"])).toBe("Can import sets and read progress");
    expect(scopesLine(["import", "read", "export"])).toBe("Can import sets, read progress and export");
    expect(scopesLine([])).toBe("Can do nothing");
  });

  it("says a key that manages adds, changes, and deletes her content, and where its deletes go", () => {
    const line = "add, change, and delete your sets, questions, folders, courses, and topics. What it deletes goes to Recently deleted.";
    expect(scopesLine(["manage"])).toBe(`Can ${line}`);
    expect(scopesLine(["import", "manage"])).toBe(`Can ${line}`);
    expect(scopesLine(["import", "read", "manage"])).toBe(`Can read progress, and ${line}`);
  });

  it("says what revoking leaves: the sets it imported, and for a key that manages, what it changed and deleted", () => {
    expect(revokeMessage(["import"])).toContain("The sets it imported stay where they are.");
    const manage = revokeMessage(["import", "manage"]);
    expect(manage).toContain("What it imported or changed stays as it is, and what it deleted stays in Recently deleted.");
    expect(manage).toMatch(/^Its key stops working at once and for good\./);
  });

  it("says when it was made and last used, or that it never was", () => {
    expect(keyDates(key())).toMatch(/^Made \S+( \d+)? · Never used$/);
    expect(keyDates(key({ lastUsedAt: new Date().toISOString() }))).toMatch(/ · Last used today$/);
  });

  it("says when it was revoked instead of when it was last used", () => {
    const line = keyDates(key({ lastUsedAt: "2026-03-03T10:00:00Z", revokedAt: new Date().toISOString() }));
    expect(line).toMatch(/ · Revoked today$/);
    expect(line).not.toContain("Last used");
  });
});

describe("a refusal", () => {
  it("is the server's own words when it sent some", () => {
    const caught = new ApiError(404, { error: "pairing_not_found", message: "No agent is waiting under that code." });
    expect(refusal(caught, "fallback")).toBe("No agent is waiting under that code.");
  });

  it("is the fallback when the server sent nothing, or the request never reached it", () => {
    expect(refusal(new ApiError(502, null), "fallback")).toBe("fallback");
    expect(refusal(new TypeError("Failed to fetch"), "fallback")).toBe("fallback");
  });
});
