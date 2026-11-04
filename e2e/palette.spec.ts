import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, signIn } from "./sign-in";

// The light tint (--accent-600) of each color scheme.
const DUSK_TINT = "#7c3f60";
const SLATE_TINT = "#495764";

test.describe("color scheme", () => {
  test.beforeEach(async ({ browserName, page }) => {
    test.skip(browserName !== "chromium", "account changes run once, on desktop Chrome");
    await page.emulateMedia({ colorScheme: "light" });
  });

  test("Slate follows his account across a reload, a sign-out and another device, and hers stays Dusk", async ({
    browser,
    page,
  }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    try {
      await page.goto("/settings");
      const color = page.getByRole("tablist", { name: "Color" });
      await expect(color.getByRole("tab", { name: "Dusk" })).toHaveAttribute("aria-selected", "true");
      await expectPalette(page, "dusk", DUSK_TINT);

      const saved = page.waitForResponse((response) => response.url().endsWith("/api/me/palette"));
      await color.getByRole("tab", { name: "Slate" }).click();
      await expectPalette(page, "slate", SLATE_TINT);
      expect((await saved).status()).toBe(200);
      await expect(color.getByRole("tab", { name: "Slate" })).toHaveAttribute("aria-selected", "true");
      // Look is per device and untouched by the pick.
      await expect(page.locator("html")).toHaveAttribute("data-theme", "auto");

      await page.reload();
      await expect(color.getByRole("tab", { name: "Slate" })).toHaveAttribute("aria-selected", "true");
      await expectPalette(page, "slate", SLATE_TINT);

      // Signed out, the sign-in screen is Dusk and this device keeps nothing of his scheme.
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Qbank" })).toBeVisible();
      await expectPalette(page, "dusk", DUSK_TINT);
      expect(await page.evaluate(() => localStorage.getItem("qbank-palette"))).toBeNull();

      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await expectPalette(page, "slate", SLATE_TINT);

      const device = await browser.newContext();
      const other = await device.newPage();
      await signIn(other, ADMIN_EMAIL, ADMIN_PASSWORD);
      await expectPalette(other, "slate", SLATE_TINT);
      await device.close();

      const hers = await browser.newContext();
      const student = await hers.newPage();
      await signIn(student);
      await expectPalette(student, "dusk", DUSK_TINT);
      await student.goto("/settings");
      await expect(student.getByRole("tablist", { name: "Color" }).getByRole("tab", { name: "Dusk" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await hers.close();
    } finally {
      await resetPalette(page);
    }
  });

  test("the last scheme paints before the session answers", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    try {
      await page.goto("/settings");
      await page.getByRole("tablist", { name: "Color" }).getByRole("tab", { name: "Slate" }).click();
      await expect(page.getByRole("tablist", { name: "Color" }).getByRole("tab", { name: "Slate" })).toHaveAttribute(
        "aria-selected",
        "true",
      );

      let answer = (): void => undefined;
      const held = new Promise<void>((resolve) => {
        answer = resolve;
      });
      await page.route("**/api/session", async (route) => {
        await held;
        await route.continue();
      });
      await page.reload();
      await expect(page.getByRole("status")).toHaveText("Checking the session...");
      await expectPalette(page, "slate", SLATE_TINT);
      answer();
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
      await expectPalette(page, "slate", SLATE_TINT);
      await page.unroute("**/api/session");
    } finally {
      await resetPalette(page);
    }
  });

  test("a pick that cannot be saved goes back, and says so", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/settings");
    await page.route("**/api/me/palette", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "internal", message: "Your color could not be saved. Try again." }),
      }),
    );

    const color = page.getByRole("tablist", { name: "Color" });
    await color.getByRole("tab", { name: "Slate" }).click();
    await expect(page.getByRole("alert")).toHaveText("Your color could not be saved. Try again.");
    await expect(color.getByRole("tab", { name: "Dusk" })).toHaveAttribute("aria-selected", "true");
    await expectPalette(page, "dusk", DUSK_TINT);

    await page.unroute("**/api/me/palette");
    await page.reload();
    await expectPalette(page, "dusk", DUSK_TINT);
  });
});

async function expectPalette(page: Page, palette: string, tint: string): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tint").trim().toLowerCase()))
    .toBe(tint);
}

/** Puts his account back on Dusk, so other tests and the next run start from the default. */
async function resetPalette(page: Page): Promise<void> {
  // Signs in again first: the test may have stopped while signed out.
  const signedIn = await page.request.post("/api/sign-in/password", { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  expect(signedIn.status()).toBe(200);
  const response = await page.request.put("/api/me/palette", { data: { palette: "dusk" } });
  expect(response.status()).toBe(200);
}
