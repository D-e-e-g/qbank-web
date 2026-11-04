import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSignOutEverywhere, SIGN_OUT_EVERYWHERE, SIGN_OUT_EVERYWHERE_QUESTION } from "./sign-out-everywhere";

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

describe("the row", () => {
  it("says what the iPhone app says", () => {
    expect(SIGN_OUT_EVERYWHERE).toBe("Sign out everywhere");
    expect(SIGN_OUT_EVERYWHERE_QUESTION).toBe("Sign out of QBank on every device, including this one?");
  });
});

describe("signing out everywhere", () => {
  it("sends nothing but a POST to /api/sign-out/everywhere, and every session has ended", async () => {
    const calls = fakeApi({ status: 200, body: { status: "signed_out_everywhere" } });
    expect(await requestSignOutEverywhere()).toEqual({ kind: "signed-out" });
    expect(calls).toEqual([{ url: "/api/sign-out/everywhere", method: "POST", body: undefined }]);
  });

  it("takes any 2xx as signed out, whatever its body", async () => {
    fakeApi({ status: 200, text: "not json" });
    expect(await requestSignOutEverywhere()).toEqual({ kind: "signed-out" });
    fakeApi({ status: 204 });
    expect(await requestSignOutEverywhere()).toEqual({ kind: "signed-out" });
  });

  it("signs out here too when this session had already ended", async () => {
    fakeApi({ status: 401, body: { error: "unauthenticated", message: "Sign in to continue." } });
    expect(await requestSignOutEverywhere()).toEqual({ kind: "signed-out" });
  });
});

describe("a refusal ends nothing and says why", () => {
  it.each([
    [502, "auth_failed", "Signing out everywhere did not work. Try again."],
    [503, "auth_unavailable", "Sign-in is not available right now."],
  ])("%i %s: the server's sentence, and she stays signed in", async (status, error, message) => {
    fakeApi({ status, body: { error, message } });
    expect(await requestSignOutEverywhere()).toEqual({ kind: "refused", message });
  });

  it("a dropped connection says to try again", async () => {
    fakeApi(new TypeError("Failed to fetch"));
    expect(await requestSignOutEverywhere()).toEqual({ kind: "refused", message: "Signing out everywhere did not work. Try again." });
  });
});
