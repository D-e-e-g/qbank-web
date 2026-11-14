import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSignOut, SIGN_OUT_ROWS, type SignOutScope } from "./sign-out";

/** Stands in for the API: the request gets this answer, and is recorded. */
function fakeApi(answer: { status: number; body?: unknown; text?: string } | Error) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body });
      if (answer instanceof Error) return Promise.reject(answer);
      const text = answer.text ?? (answer.body === undefined ? null : JSON.stringify(answer.body));
      return Promise.resolve(new Response(text, { status: answer.status }));
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const SCOPES: SignOutScope[] = ["here", "everywhere"];

describe("the rows", () => {
  it("Sign out is sent as soon as it is tapped", () => {
    expect(SIGN_OUT_ROWS.here).toEqual({ label: "Sign out", question: null });
  });

  it("Sign out everywhere asks first, and says what the iPhone app says", () => {
    expect(SIGN_OUT_ROWS.everywhere).toEqual({
      label: "Sign out everywhere",
      question: "Sign out of QBank on every device, including this one?",
    });
  });
});

describe("signing out", () => {
  it("here: sends a POST to /api/sign-out, and this session has ended", async () => {
    const calls = fakeApi({ status: 200, body: { status: "signed_out" } });
    expect(await requestSignOut("here")).toEqual({ kind: "signed-out" });
    expect(calls).toEqual([{ url: "/api/sign-out", method: "POST", body: "{}" }]);
  });

  it("everywhere: sends nothing but a POST to /api/sign-out/everywhere, and every session has ended", async () => {
    const calls = fakeApi({ status: 200, body: { status: "signed_out_everywhere" } });
    expect(await requestSignOut("everywhere")).toEqual({ kind: "signed-out" });
    expect(calls).toEqual([{ url: "/api/sign-out/everywhere", method: "POST", body: undefined }]);
  });

  it.each(SCOPES)("%s: takes any 2xx as signed out, whatever its body", async (scope) => {
    fakeApi({ status: 200, text: "not json" });
    expect(await requestSignOut(scope)).toEqual({ kind: "signed-out" });
    fakeApi({ status: 204 });
    expect(await requestSignOut(scope)).toEqual({ kind: "signed-out" });
  });

  it.each(SCOPES)("%s: is signed out when this session had already ended", async (scope) => {
    fakeApi({ status: 401, body: { error: "unauthenticated", message: "Sign in to continue." } });
    expect(await requestSignOut(scope)).toEqual({ kind: "signed-out" });
  });
});

describe("a refusal ends nothing and says why", () => {
  it.each([
    ["here", 503, "auth_unavailable", "Sign-in is not available right now."],
    ["here", 500, "internal_error", "Something went wrong. Try again."],
    ["everywhere", 502, "auth_failed", "Signing out everywhere did not work. Try again."],
    ["everywhere", 503, "auth_unavailable", "Sign-in is not available right now."],
  ] as const)("%s, %i %s: the server's sentence, and the account stays signed in", async (scope, status, error, message) => {
    fakeApi({ status, body: { error, message } });
    expect(await requestSignOut(scope)).toEqual({ kind: "refused", message });
  });

  it.each(SCOPES)("%s: an answer that is not the API's is still a refusal", async (scope) => {
    fakeApi({ status: 502, text: "<h1>Bad gateway</h1>" });
    expect(await requestSignOut(scope)).toEqual({ kind: "refused", message: "The server answered 502." });
  });

  it.each([
    ["here", "Signing out did not work. Try again."],
    ["everywhere", "Signing out everywhere did not work. Try again."],
  ] as const)("%s: a dropped connection says to try again", async (scope, message) => {
    fakeApi(new TypeError("Failed to fetch"));
    expect(await requestSignOut(scope)).toEqual({ kind: "refused", message });
  });
});
