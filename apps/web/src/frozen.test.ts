import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";
import { frozenNote } from "./frozen";
import { forgetStudents, refreshStudents } from "./students";

const VIEWED = { students: [{ id: "one", email: "sam@example.com", name: "Sam", createdAt: "2026-10-01T00:00:00Z" }], viewingId: "one" };

function answer(status: number, body: unknown): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

describe("the frozen note", () => {
  afterEach(() => {
    forgetStudents();
    vi.unstubAllGlobals();
  });

  it("names the account on screen, in the words the iPhone uses", () => {
    expect(frozenNote("sam@example.com")).toBe("This is a frozen view of sam@example.com. Nothing here can be changed.");
    expect(frozenNote(null)).toBe("This is a frozen view of a user account. Nothing here can be changed.");
  });

  it("replaces the server's words when a refusal still arrives", async () => {
    answer(200, VIEWED);
    await refreshStudents();
    answer(403, { error: "admin_read_only", message: "This is a read-only view of a user account. Nothing here can be changed." });
    const refused = await api("/api/folders/one", { method: "PATCH", json: {} }).catch((caught: unknown) => caught);
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).message).toBe("This is a frozen view of sam@example.com. Nothing here can be changed.");
  });

  it("leaves every other refusal as the server said it", async () => {
    answer(403, { error: "admin_cannot_delete_account", message: "The admin account can't be deleted." });
    const refused = await api("/api/me", { method: "DELETE" }).catch((caught: unknown) => caught);
    expect((refused as ApiError).message).toBe("The admin account can't be deleted.");
  });
});
