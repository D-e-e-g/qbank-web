import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, newAccount, signIn, signInHere, type FakeAccount } from "./sign-in";

// Delete account in Settings: a warning that says everything goes for good, her current password,
// and Delete account, which deletes the signed-in user account on the server and signs her out on
// every device. A refusal deletes nothing and keeps her signed in, in the server's words. Every test
// deletes or refuses on a throwaway account of its own, never the sample student.

/** A course with one set of single-answer questions, imported into a new Semester 1; option 0 is right. */
async function giveCourse(request: APIRequestContext, code: string, size: number): Promise<string[]> {
  expect((await request.post("/api/semesters", { data: { number: 1 } })).status()).toBe(201);
  const source = JSON.stringify({
    title: `${code} set`,
    desc: "Invented practice set.",
    terms: {},
    questions: Array.from({ length: size }, (_, index) => ({
      id: `Q${String(index + 1)}`,
      type: "single",
      topic: `Invented topic ${String(index + 1)}`,
      stem: `Invented stem ${String(index + 1)}.`,
      ask: "Which action comes first?",
      options: [
        { t: "The useful action", ok: true, why: "It addresses the finding." },
        { t: "A distractor", why: "It does not change the finding." },
        { t: "Another distractor", why: "It does not change the finding either." },
      ],
      rationale: "The useful action matches the finding.",
      takeaway: "Match the action to the finding.",
      terms: [],
    })),
  });
  const imported = await request.post("/api/imports", { data: { source, folderName: "Week 1", newCourse: { code, title: "Invented course", semesterNumber: 1 } } });
  expect(imported.status()).toBe(201);
  const { courseId } = (await imported.json()) as { courseId: string };
  const detail = (await (await request.get(`/api/courses/${courseId}`)).json()) as { folders: { sets: { questionIds: string[] }[] }[] };
  return detail.folders.flatMap((folder) => folder.sets).flatMap((set) => set.questionIds);
}

interface Catalog {
  semesters: { courses: { code: string; questionCount: number; answeredCount: number }[] }[];
}

async function catalog(request: APIRequestContext): Promise<Catalog> {
  const answer = await request.get("/api/semesters");
  expect(answer.status()).toBe(200);
  return (await answer.json()) as Catalog;
}

function uniqueCode(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
}

/** Opens Delete account from Settings and returns its sheet. */
async function openDelete(page: Page) {
  await page.getByRole("button", { name: "Delete account" }).click();
  const sheet = page.getByRole("dialog", { name: "Delete your user account?" });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function signedOut(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Qbank" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
}

test("deletes her user account for good and signs her out everywhere, and another account's courses and answers stay", async ({ browser, page }) => {
  const kept = await newAccount(browser, "kept");
  const doomed = await newAccount(browser, "doomed");
  const keptCode = uniqueCode("KEEP");
  const doomedCode = uniqueCode("GONE");

  // The other account has a course and an answer of its own.
  const keptContext = await browser.newContext();
  expect((await keptContext.request.post("/api/sign-in/password", { data: kept })).status()).toBe(200);
  const [keptQuestion] = await giveCourse(keptContext.request, keptCode, 3);
  const saved = await keptContext.request.post("/api/attempts", {
    data: { clientAttemptId: crypto.randomUUID(), questionId: keptQuestion, response: { type: "single", choice: 0 }, guessed: false },
  });
  expect(saved.status()).toBe(201);
  const keptBefore = await catalog(keptContext.request);
  expect(keptBefore.semesters.flatMap((semester) => semester.courses)).toMatchObject([{ code: keptCode, questionCount: 3, answeredCount: 1 }]);

  // The doomed account is signed in on another device too.
  const otherDevice = await browser.newContext();
  expect((await otherDevice.request.post("/api/sign-in/password", { data: doomed })).status()).toBe(200);

  await signIn(page, doomed.email, doomed.password);
  await giveCourse(page.request, doomedCode, 2);
  await page.goto("/");
  await expect(page.getByText(doomedCode).first()).toBeVisible();
  await openSettings(page);

  // Cancel changes nothing.
  let sheet = await openDelete(page);
  await expect(sheet).toContainText(`Your user account, ${doomed.email}, and everything in it are deleted for good`);
  await expect(sheet).toContainText("You are signed out on every device. Nothing goes to Recently deleted, and there is no Undo.");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();

  // No password, then a wrong one: nothing is deleted and she stays signed in.
  sheet = await openDelete(page);
  await sheet.getByRole("button", { name: "Delete account" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Enter your password to delete your account.");
  await sheet.getByLabel("Current password").fill("not-her-password");
  await sheet.getByRole("button", { name: "Delete account" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("That password is not right.");
  await expect(sheet.getByLabel("Current password")).toHaveValue("");
  expect((await page.request.get("/api/session")).status()).toBe(200);
  expect((await catalog(page.request)).semesters.flatMap((semester) => semester.courses).map((course) => course.code)).toEqual([doomedCode]);

  await sheet.getByLabel("Current password").fill(doomed.password);
  await sheet.getByRole("button", { name: "Delete account" }).click();
  await signedOut(page);
  expect(await page.evaluate(() => localStorage.getItem("qbank-palette"))).toBeNull();

  // Gone on every device, and it can no longer sign in.
  expect((await page.request.get("/api/session")).status()).toBe(401);
  expect((await otherDevice.request.get("/api/session")).status()).toBe(401);
  expect((await otherDevice.request.get("/api/semesters")).status()).toBe(401);
  await page.getByLabel("Email").fill(doomed.email);
  await page.getByLabel("Password").fill(doomed.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("That email or password is not right.");

  // The other account signs in on the same screen: none of the deleted account shows, even before
  // its own courses arrive, and its course and answer are as they were.
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/semesters", async (route) => {
    await held;
    await route.continue();
  });
  await signInHere(page, kept.email, kept.password);
  // It lands on the course it used last, then goes Home.
  await expect(page.getByRole("heading", { level: 1, name: keptCode })).toBeVisible();
  await page.getByRole("navigation", { name: /^(Sections|Tabs)$/ }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.getByText(doomedCode)).toHaveCount(0);
  release();
  await expect(page.getByRole("main").getByText(keptCode)).toBeVisible();
  await page.unroute("**/api/semesters");
  expect(await catalog(keptContext.request)).toEqual(keptBefore);

  await keptContext.close();
  await otherDevice.close();
});

test("the admin's Settings has no Delete account", async ({ page }) => {
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openSettings(page);
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete account" })).toHaveCount(0);
});

test.describe("when the server refuses", () => {
  let account: FakeAccount;

  test.beforeEach(async ({ browser, page }) => {
    account = await newAccount(browser, "refused");
    await signIn(page, account.email, account.password);
    await openSettings(page);
  });

  test("each refusal shows the server's sentence, deletes nothing, and keeps her signed in", async ({ page }) => {
    const refusals = [
      { status: 400, error: "invalid_request", message: "Enter your password." },
      { status: 403, error: "agent_key_not_allowed", message: "An agent key can't delete an account." },
      { status: 403, error: "admin_cannot_delete_account", message: "The admin account can't be deleted." },
      { status: 409, error: "in_use", message: "QBank is still making a set in NURS 220. Wait until it is filed, or cancel it, then delete your account." },
      { status: 503, error: "auth_unavailable", message: "Sign-in is not available right now." },
    ];
    let next = 0;
    await page.route("**/api/me", (route) => {
      const refusal = refusals[next++];
      return refusal === undefined
        ? route.abort()
        : route.fulfill({ status: refusal.status, contentType: "application/json", body: JSON.stringify({ error: refusal.error, message: refusal.message }) });
    });
    const sheet = await openDelete(page);
    for (const refusal of refusals) {
      await sheet.getByLabel("Current password").fill(account.password);
      await sheet.getByRole("button", { name: "Delete account" }).click();
      await expect(sheet.getByRole("alert")).toHaveText(refusal.message);
      await expect(sheet.getByRole("button", { name: "Delete account" })).toBeEnabled();
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    }
    await page.unroute("**/api/me");
    expect((await page.request.get("/api/session")).status()).toBe(200);
  });

  test("five wrong passwords lock Delete, as they lock sign-in", async ({ page }) => {
    const sheet = await openDelete(page);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await sheet.getByLabel("Current password").fill("not-her-password");
      await sheet.getByRole("button", { name: "Delete account" }).click();
      await expect(sheet.getByRole("alert")).toHaveText("That password is not right.");
    }
    await sheet.getByLabel("Current password").fill("not-her-password");
    await sheet.getByRole("button", { name: "Delete account" }).click();
    await expect(sheet.getByRole("alert")).toHaveText("Too many tries. Try again in 15 minutes.");
    await expect(sheet.getByRole("button", { name: "Delete account" })).toBeDisabled();
    // Her right password waits for the lock too, and nothing was deleted.
    await sheet.getByLabel("Current password").fill(account.password);
    await expect(sheet.getByRole("button", { name: "Delete account" })).toBeDisabled();
    expect((await page.request.get("/api/session")).status()).toBe(200);
  });

  test("Delete waits for the lock's time, then she can try again", async ({ page }) => {
    await page.route("**/api/me", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "retry-after": "2" },
        body: JSON.stringify({ error: "too_many_attempts", message: "Too many tries. Try again in 1 minute.", retryAfterSeconds: 2 }),
      }),
    );
    const sheet = await openDelete(page);
    await sheet.getByLabel("Current password").fill("not-her-password");
    await sheet.getByRole("button", { name: "Delete account" }).click();
    await expect(sheet.getByRole("alert")).toHaveText("Too many tries. Try again in 1 minute.");
    await expect(sheet.getByRole("button", { name: "Delete account" })).toBeDisabled();
    await expect(sheet.getByRole("button", { name: "Delete account" })).toBeEnabled({ timeout: 5000 });
    await expect(sheet.getByRole("alert")).toHaveCount(0);
  });

  test("a temporary password leads to choosing a new one", async ({ page }) => {
    await page.route("**/api/me", (route) =>
      route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "must_change_password", message: "Choose a new password to continue." }) }),
    );
    const sheet = await openDelete(page);
    await sheet.getByLabel("Current password").fill(account.password);
    await sheet.getByRole("button", { name: "Delete account" }).click();
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await expect(page.getByLabel("Temporary password")).toBeVisible();
  });

  test("once the account is gone on another device, Delete signs her out", async ({ browser, page }) => {
    const elsewhere = await browser.newContext();
    expect((await elsewhere.request.post("/api/sign-in/password", { data: account })).status()).toBe(200);
    expect((await elsewhere.request.delete("/api/me", { data: { password: account.password } })).status()).toBe(200);
    await elsewhere.close();

    const sheet = await openDelete(page);
    await sheet.getByLabel("Current password").fill(account.password);
    await sheet.getByRole("button", { name: "Delete account" }).click();
    await signedOut(page);
  });
});
