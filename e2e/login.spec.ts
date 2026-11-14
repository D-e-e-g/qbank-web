import { expect, test } from "./fixtures";
import { ADMIN_EMAIL, ADMIN_PASSWORD, newAccount, signIn, signInHere, STUDENT_EMAIL, STUDENT_PASSWORD } from "./sign-in";

test("the sign-in screen asks for a password only and does not send email", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Qbank" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByText(/passkey/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign up", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Forgot password?" })).toBeVisible();
  await expect(page.getByText("This app doesn't send email.")).toBeVisible();
  await expect(page.getByText(/temporary password/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send reset link" })).toHaveCount(0);
});

test("signing out leaves none of her courses on screen for the next account", async ({ browser, page }) => {
  const first = await newAccount(browser, "first");
  const next = await newAccount(browser, "next");
  const code = `MINE${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
  await signIn(page, first.email, first.password);
  const semester = await page.request.post("/api/semesters", { data: { number: 1 } });
  expect(semester.status()).toBe(201);
  const semesterId = ((await semester.json()) as { id: string }).id;
  expect((await page.request.post("/api/courses", { data: { semesterId, code, title: "Invented course" } })).status()).toBe(201);
  await page.goto("/");
  await expect(page.getByText(code).first()).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Qbank" })).toBeVisible();

  // The next account's own courses are slow to arrive; hers never show meanwhile.
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/semesters", async (route) => {
    await held;
    await route.continue();
  });
  await signInHere(page, next.email, next.password);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.getByText(code)).toHaveCount(0);
  const answered = page.waitForResponse("**/api/semesters");
  release();
  await answered;
  await expect(page.getByText(code)).toHaveCount(0);
});

test("a Sign out that fails keeps the account signed in and says why, until one gets through", async ({ browser, page }) => {
  const account = await newAccount(browser, "refused");
  await signIn(page, account.email, account.password);
  await page.getByRole("link", { name: "Settings" }).click();
  const signedInAs = page.getByText(`Signed in as ${account.email}.`);
  const signOut = page.getByRole("button", { name: "Sign out", exact: true });
  const signInScreen = page.getByRole("button", { name: "Sign in", exact: true });

  // No connection: the request never reaches the server, so the session cookie is still good.
  await page.route("**/api/sign-out", (route) => route.abort("internetdisconnected"));
  await signOut.click();
  await expect(page.getByRole("alert")).toHaveText("Signing out did not work. Try again.");
  await expect(signedInAs).toBeVisible();
  await expect(signInScreen).toHaveCount(0);
  expect((await page.request.get("/api/session")).status()).toBe(200);
  await page.unroute("**/api/sign-out");

  // The server refuses: its own sentence, and still signed in.
  await page.route("**/api/sign-out", (route) =>
    route.fulfill({ status: 503, json: { error: "auth_unavailable", message: "Sign-in is not available right now." } }),
  );
  await signOut.click();
  await expect(page.getByRole("alert")).toHaveText("Sign-in is not available right now.");
  await expect(signedInAs).toBeVisible();
  expect((await page.request.get("/api/session")).status()).toBe(200);
  await page.unroute("**/api/sign-out");

  // Sign out everywhere is refused the same way, under its own button.
  await page.route("**/api/sign-out/everywhere", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await page
    .getByRole("dialog", { name: "Sign out of QBank on every device, including this one?" })
    .getByRole("button", { name: "Sign out everywhere" })
    .click();
  await expect(page.getByRole("alert")).toHaveText(["Sign-in is not available right now.", "Signing out everywhere did not work. Try again."]);
  await expect(signedInAs).toBeVisible();
  expect((await page.request.get("/api/session")).status()).toBe(200);
  await page.unroute("**/api/sign-out/everywhere");

  // Opened again, the tab is as signed in as the screen said it was.
  await page.reload();
  await expect(signedInAs).toBeVisible();

  // Once the request gets through, sign-in shows, and opening the tab again stays there.
  await signOut.click();
  await expect(signInScreen).toBeVisible();
  expect((await page.request.get("/api/session")).status()).toBe(401);
  await page.reload();
  await expect(signInScreen).toBeVisible();
  await expect(signedInAs).toHaveCount(0);
});

test("Sign out everywhere asks once, then signs out this browser and every other one of the account", async ({ browser, page }) => {
  const account = await newAccount(browser, "everywhere");
  // The same user account in another browser, and the admin in a third.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, account.email, account.password);
  const admin = await browser.newContext();
  expect((await admin.request.post("/api/sign-in/password", { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })).status()).toBe(200);

  await signIn(page, account.email, account.password);
  await page.getByRole("link", { name: "Settings" }).click();
  const sheet = page.getByRole("dialog", { name: "Sign out of QBank on every device, including this one?" });

  // Cancel changes nothing.
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
  expect((await page.request.get("/api/session")).status()).toBe(200);
  expect((await otherPage.request.get("/api/session")).status()).toBe(200);

  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await sheet.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page.getByRole("heading", { name: "Qbank" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  expect((await page.request.get("/api/session")).status()).toBe(401);

  // The other browser is on the sign-in screen the next time it opens QBank; the admin stays signed in.
  await otherPage.goto("/");
  await expect(otherPage.getByRole("heading", { name: "Qbank" })).toBeVisible();
  await expect(otherPage.getByLabel("Email")).toBeVisible();
  expect((await admin.request.get("/api/session")).status()).toBe(200);

  // Signing in again works as before.
  await signInHere(page, account.email, account.password);
  await other.close();
  await admin.close();
});

test.describe("signed-in account", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "account changes run once, on desktop Chrome");
  });

  test("keeps two browsers signed in until each one signs out", async ({ browser }) => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    const pageA = await first.newPage();
    const pageB = await second.newPage();
    await signIn(pageA);
    await signIn(pageB);

    await pageA.getByRole("link", { name: "Settings" }).click();
    await pageA.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(pageA.getByRole("heading", { name: "Qbank" })).toBeVisible();

    await pageB.goto("/");
    await expect(pageB.getByRole("heading", { name: "Home" })).toBeVisible();
    await first.close();
    await second.close();
  });

  test("locks an address after five wrong passwords", async ({ page }) => {
    const email = `nobody-${String(Date.now())}@example.com`;
    await page.goto("/");
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      // The server also refuses a fourth sign-in from one address within 10 seconds of the last,
      // before it checks the password. The fourth waits that out, so every try counts toward the lock.
      if (attempt === 4) await page.waitForTimeout(10_500);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill("wrong-password");
      const answered = page.waitForResponse("**/api/sign-in/password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      expect((await answered).status()).toBe(401);
      await expect(page.getByRole("alert")).toHaveText("That email or password is not right.");
    }
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Too many tries. Try again in 15 minutes.");
  });

  test("a password sign-in lands on Home with nothing to dismiss, and Settings has no passkeys", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(STUDENT_EMAIL);
    await page.getByLabel("Password").fill(STUDENT_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();
    await expect(page.getByText(/passkey/i)).toHaveCount(0);
  });

  test("the admin resets her password, and she chooses her own", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.getByRole("link", { name: "Accounts" }).click();
    const denied = await page.request.post("/api/attempts", {
      data: {
        clientAttemptId: crypto.randomUUID(),
        questionId: "q1",
        response: { choice: "a" },
        guessed: false,
      },
    });
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "admin_cannot_record_answer" });

    await page.getByLabel("Temporary password").fill("temp-pass-1");
    await page.getByRole("button", { name: "Set temporary password" }).click();
    await expect(page.getByText(`Temporary password set for ${STUDENT_EMAIL}. They'll choose their own the next time they sign in.`)).toBeVisible();

    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Email").fill(STUDENT_EMAIL);
    await page.getByLabel("Password").fill("temp-pass-1");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await page.getByLabel("Temporary password").fill("temp-pass-1");
    await page.getByLabel("New password").fill(STUDENT_PASSWORD);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  });
});

test.describe("sign-up", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "sign-up makes an account, so it runs once, on desktop Chrome");
  });

  test("the admin lets an email sign up, and only that email gets an account", async ({ page }) => {
    const email = `new-${String(Date.now())}@example.com`;
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.getByRole("link", { name: "Accounts" }).click();
    await page.getByLabel("Email to add").fill(email);
    await page.getByRole("button", { name: "Add email" }).click();
    const list = page.getByRole("list", { name: "Emails that can sign up" });
    await expect(list.getByText(email)).toBeVisible();
    await expect(list.getByRole("listitem").filter({ hasText: email })).toContainText("not signed up yet");

    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign up" })).toBeVisible();

    await page.getByLabel("Email").fill(`stranger-${String(Date.now())}@example.com`);
    await page.getByLabel("Password").fill("new-pass-123");
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(/can't sign up here/);

    await page.getByLabel("Email").fill(STUDENT_EMAIL);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(/can't sign up here/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Choose a password of at least 8 characters.");

    await page.getByLabel("Password").fill("new-pass-123");
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();

    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.getByRole("link", { name: "Accounts" }).click();
    await expect(list.getByRole("listitem").filter({ hasText: email })).toContainText("Has an account");
    const accounts = page.getByRole("list", { name: "User accounts" });
    await accounts.getByRole("button", { name: new RegExp(email) }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(page.getByText(`Viewing ${email}`)).toBeVisible();

    await page.getByRole("link", { name: "Accounts" }).click();
    await expect(page.getByText(`For ${email}.`, { exact: false })).toBeVisible();
    await page.getByRole("list", { name: "User accounts" }).getByRole("button", { name: new RegExp(STUDENT_EMAIL) }).click();
    await expect(page.getByText(`Viewing ${STUDENT_EMAIL}`)).toBeVisible();
  });
});
