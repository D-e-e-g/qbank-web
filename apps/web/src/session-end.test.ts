import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, bindSessionEnd, type CatalogRecord, type SemesterCourse, type SemesterRecord } from "./api";
import { currentCatalog, findCourse, forgetCatalog, refreshCatalog } from "./catalog";
import { currentUndoOffer, forgetUndo, offerUndo, type DeletionPreview } from "./course/deletion";
import { changePassword, signInWithPassword, signUp, type Account } from "./login/api";
import { requestDeletion } from "./login/delete-account";
import { applySessionNotice, type Gate } from "./session-end";

const account: Account = {
  id: "account-1",
  email: "someone@example.com",
  name: "Someone",
  role: "student",
  mustChangePassword: false,
  palette: "dusk",
};

const signedIn: Gate = { status: "signed-in", user: account };

const SIGN_IN = { error: "unauthenticated", message: "Sign in to continue." };
const WRONG_PASSWORD = { error: "invalid_credentials", message: "That password is not right." };
const MUST_CHANGE = { error: "must_change_password", message: "Choose a new password to continue." };

const hers: CatalogRecord = {
  semesters: [semester(1, [card("nurs420", "course", "Health assessment")])],
  topics: [],
};

function card(id: string, kind: SemesterCourse["kind"], title: string): SemesterCourse {
  return {
    id,
    kind,
    code: id.toUpperCase(),
    title,
    sortOrder: 0,
    archivedAt: null,
    questionCount: 0,
    weekCount: 0,
    folderCount: 0,
    reviewCount: 0,
    answeredCount: 0,
    fullyRightCount: 0,
    points: 0,
    maxPoints: 0,
  };
}

function semester(number: number, courses: SemesterCourse[]): SemesterRecord {
  return { id: `s${String(number)}`, number, name: `Semester ${String(number)}`, startsOn: null, endsOn: null, archivedAt: null, courses };
}

const setPreview: DeletionPreview = {
  kind: "set",
  preview: {
    setId: "0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e",
    title: "Perfusion",
    kind: "practice",
    folderId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    folderName: "Week 4",
    examPageId: null,
    questionCount: 3,
    versionCount: 1,
    answeredCount: 0,
    reviewCount: 0,
    progress: {
      answeredCount: { before: 1, after: 0 },
      fullyRightCount: { before: 0, after: 0 },
      reviewCount: { before: 0, after: 0 },
      points: { before: 0, after: 0 },
      maxPoints: { before: 1, after: 0 },
      wrongCount: { before: 0, after: 0 },
    },
    message: "Delete Perfusion?",
    warning: { title: "Delete Perfusion?", body: "" },
    refusal: null,
    confirm: "set-token",
    undoDays: 30,
  },
};

let pathname = "/course/nurs420";
let stopWatching: (() => void) | null = null;
let gate: Gate = signedIn;

function readGate(): Gate {
  return gate;
}

function stubBrowser(): void {
  pathname = "/course/nurs420";
  const location = {
    get pathname() {
      return pathname;
    },
    set pathname(next: string) {
      pathname = next;
    },
    search: "",
  };
  vi.stubGlobal("window", {
    location,
    history: {
      pushState: (_data: unknown, _title: string, url?: string | URL | null) => {
        if (typeof url === "string") pathname = url;
      },
    },
    dispatchEvent: () => true,
  });
  vi.stubGlobal("document", { querySelector: () => null });
  vi.stubGlobal(
    "PopStateEvent",
    class {
      readonly type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
  );
}

function watchSignedIn(): void {
  gate = signedIn;
  stopWatching = bindSessionEnd((notice) => {
    applySessionNotice(notice, (update) => {
      gate = update(gate);
    });
  });
}

function fake(answer: { status: number; body?: unknown }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      const text = answer.body === undefined ? "" : JSON.stringify(answer.body);
      return Promise.resolve(new Response(text, { status: answer.status }));
    }),
  );
}

async function showHerCatalog(): Promise<void> {
  fake({ status: 200, body: hers });
  await refreshCatalog();
}

beforeEach(() => {
  stubBrowser();
  watchSignedIn();
});

afterEach(() => {
  stopWatching?.();
  stopWatching = null;
  forgetCatalog();
  forgetUndo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a 401 from a normal route", () => {
  it("signs out to the sign-in screen and drops this account on this device", async () => {
    await showHerCatalog();
    offerUndo("nurs420", [setPreview]);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(currentUndoOffer()).not.toBeNull();
    fake({ status: 401, body: SIGN_IN });

    await expect(api("/api/semesters")).rejects.toMatchObject({ status: 401, message: "Sign in to continue." });

    expect(readGate()).toEqual({ status: "signed-out" });
    expect(pathname).toBe("/");
    expect(findCourse(currentCatalog(), "nurs420")).toBeUndefined();
    expect(currentCatalog().fromServer).toBe(false);
    expect(currentUndoOffer()).toBeNull();
  });

  it("treats a filtered read the same", async () => {
    fake({ status: 401, body: SIGN_IN });
    await expect(api("/api/courses/nurs420/review?filter=missed")).rejects.toBeInstanceOf(ApiError);
    expect(readGate().status).toBe("signed-out");
  });

  it("signs out on a delete that is not delete-account", async () => {
    fake({ status: 401, body: SIGN_IN });
    await expect(api("/api/admin/sign-up-emails/someone@example.com", { method: "DELETE" })).rejects.toBeInstanceOf(ApiError);
    expect(readGate().status).toBe("signed-out");
  });
});

describe("a 401 inside sign-in, sign-up and delete-account", () => {
  it.each([
    ["/api/sign-in/password", "POST"],
    ["/api/sign-up", "POST"],
    ["/api/me", "DELETE"],
  ])("stays signed in for %s", async (path, method) => {
    await showHerCatalog();
    fake({ status: 401, body: WRONG_PASSWORD });
    await expect(api(path, { method, json: { password: "wrong-pass-1" } })).rejects.toBeInstanceOf(ApiError);
    expect(readGate()).toEqual(signedIn);
    expect(findCourse(currentCatalog(), "nurs420")?.title).toBe("Health assessment");
  });

  it("stays on the sign-in form when the password is wrong", async () => {
    fake({ status: 401, body: { error: "invalid_credentials", message: "That email or password is not right." } });
    await expect(signInWithPassword("someone@example.com", "wrong-pass-1")).rejects.toThrow("That email or password is not right.");
    expect(readGate()).toEqual(signedIn);
  });

  it("stays on the sign-up form", async () => {
    fake({ status: 401, body: { error: "invalid_credentials", message: "Sign-up failed." } });
    await expect(signUp("someone@example.com", "wrong-pass-1")).rejects.toThrow("Sign-up failed.");
    expect(readGate()).toEqual(signedIn);
  });

  it("lets delete-account show a wrong password, and does not sign out", async () => {
    fake({ status: 401, body: WRONG_PASSWORD });
    await expect(requestDeletion("wrong-pass-1")).resolves.toMatchObject({ kind: "refused", clearPassword: true });
    expect(readGate()).toEqual(signedIn);
  });

  it("lets delete-account handle a session that had already ended", async () => {
    fake({ status: 401, body: SIGN_IN });
    await expect(requestDeletion("current-pass-1")).resolves.toEqual({ kind: "signed-out" });
    expect(readGate()).toEqual(signedIn);
  });
});

describe("choosing a new password", () => {
  it("stays when the current password is wrong", async () => {
    fake({ status: 401, body: WRONG_PASSWORD });
    await expect(changePassword("wrong-pass-1", "new-password-1")).rejects.toThrow("That password is not right.");
    expect(readGate()).toEqual(signedIn);
  });

  it("signs out when that route says the session ended", async () => {
    fake({ status: 401, body: SIGN_IN });
    await expect(api("/api/account/password", { method: "POST", json: { currentPassword: "x", newPassword: "new-password-1" } })).rejects.toBeInstanceOf(ApiError);
    expect(readGate().status).toBe("signed-out");
  });
});

describe("a must_change_password 403", () => {
  it.each([
    ["/api/semesters", "GET"],
    ["/api/sign-in/password", "POST"],
    ["/api/sign-up", "POST"],
    ["/api/me", "DELETE"],
    ["/api/account/password", "POST"],
  ])("goes to the change-password step from %s", async (path, method) => {
    await showHerCatalog();
    fake({ status: 403, body: MUST_CHANGE });
    await expect(api(path, { method, json: {} })).rejects.toMatchObject({ status: 403, message: "Choose a new password to continue." });
    expect(readGate()).toEqual({ status: "must-change", user: account });
    expect(findCourse(currentCatalog(), "nurs420")?.title).toBe("Health assessment");
    expect(pathname).toBe("/course/nurs420");
  });

  it("leaves any other refusal on the screen that was up", async () => {
    fake({ status: 403, body: { error: "not_allowed", message: "That is not available on this account." } });
    await expect(api("/api/semesters")).rejects.toBeInstanceOf(ApiError);
    fake({ status: 500, body: { error: "server_error", message: "Something went wrong." } });
    await expect(api("/api/semesters")).rejects.toBeInstanceOf(ApiError);
    expect(readGate()).toEqual(signedIn);
  });
});
