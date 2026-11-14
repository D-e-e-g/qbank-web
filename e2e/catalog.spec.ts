import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { newAccount, signIn } from "./sign-in";

// The first read of the user's courses, GET /api/semesters, when it fails. Every screen shares that
// one read. A read that failed is not an account with no courses: Home says so and offers Try
// again, Import does not offer the course as a new one, and Make questions does not load forever.

const CATALOG = "**/api/semesters";
const FAILED = "Could not load your courses.";

interface Course {
  id: string;
  code: string;
}

/** A new account, signed in, with one invented course in Semester 1. */
async function accountWithCourse(browser: Browser, page: Page): Promise<Course> {
  const account = await newAccount(browser, "catalog");
  await signIn(page, account.email, account.password);
  const code = `LOAD${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
  const semester = await page.request.post("/api/semesters", { data: { number: 1 } });
  expect(semester.status()).toBe(201);
  const semesterId = ((await semester.json()) as { id: string }).id;
  const course = await page.request.post("/api/courses", { data: { semesterId, code, title: "Invented course" } });
  expect(course.status()).toBe(201);
  return { id: ((await course.json()) as { id: string }).id, code };
}

/** Every read of the courses is dropped, as with no connection, until the returned function lets them through. */
async function dropCatalogReads(page: Page): Promise<() => Promise<void>> {
  await page.route(CATALOG, (route) => (route.request().method() === "GET" ? route.abort("internetdisconnected") : route.continue()));
  return () => page.unroute(CATALOG);
}

/** GET /api/question-maker as it answers an account that may make questions now; the test API has it off. */
async function makeQuestionsOn(page: Page): Promise<void> {
  await page.route("**/api/question-maker", (route) =>
    route.fulfill({
      json: {
        available: true,
        reason: null,
        dailyLimit: 5,
        startedToday: 0,
        nextAvailableAt: null,
        levels: [],
        defaultLevel: "exam",
        sampleSize: 5,
        limits: { photos: 10, photoBytes: 5_000_000, fileBytes: 20_000_000, textCharacters: 200_000 },
        imageTypes: [],
        fileTypes: [],
      },
    }),
  );
}

test("Home says the courses could not be loaded, and Try again loads them", async ({ browser, page }) => {
  const course = await accountWithCourse(browser, page);
  const restore = await dropCatalogReads(page);
  await page.goto("/");

  const main = page.getByRole("main");
  await expect(main.getByText(FAILED)).toBeVisible();
  // Not an account with no courses: no empty semester, on Home or in the sidebar, and nothing to add to.
  await expect(page.getByText("No courses yet")).toHaveCount(0);
  await expect(page.getByText("No topics yet")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Semester/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);

  // Still no connection: it says so again, and the button is still there.
  await main.getByRole("button", { name: "Try again" }).click();
  await expect(main.getByText(FAILED)).toBeVisible();

  await restore();
  await main.getByRole("button", { name: "Try again" }).click();
  await expect(main.getByText(course.code)).toBeVisible();
  await expect(main.getByText(FAILED)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();
});

test("a load that failed is tried again by itself when the device is back online", async ({ browser, page }) => {
  const course = await accountWithCourse(browser, page);
  const restore = await dropCatalogReads(page);
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main.getByText(FAILED)).toBeVisible();

  await restore();
  // The browser's own signal that the connection is back, which a saved answer retries on too.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(main.getByText(course.code)).toBeVisible();
  await expect(main.getByText(FAILED)).toHaveCount(0);
});

test("Import does not offer a new course in place of one it could not read", async ({ browser, page }) => {
  const course = await accountWithCourse(browser, page);
  const restore = await dropCatalogReads(page);
  await page.goto(`/import?course=${course.id}`);

  await expect(page.getByRole("heading", { level: 1, name: "Import" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText(FAILED)).toBeVisible();
  await expect(page.getByLabel("Course", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Course code")).toHaveCount(0);
  await expect(page.getByLabel("Course name")).toHaveCount(0);

  await restore();
  await main.getByRole("button", { name: "Try again" }).click();
  // The course it was opened with is picked, as one of the account's own.
  await expect(page.getByLabel("Course", { exact: true })).toHaveValue(course.id);
  await expect(page.getByLabel("Course code")).toHaveCount(0);
  await expect(main.getByText(FAILED)).toHaveCount(0);
});

test("Make questions says the courses could not be loaded instead of loading forever", async ({ browser, page }) => {
  const course = await accountWithCourse(browser, page);
  await makeQuestionsOn(page);
  const restore = await dropCatalogReads(page);
  await page.goto("/import/make?new=1");

  await expect(page.getByRole("heading", { level: 1, name: "Your material" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText(FAILED)).toBeVisible();
  await expect(main.getByText("Loading your courses")).toHaveCount(0);
  await expect(page.getByLabel("Course", { exact: true })).toHaveCount(0);

  await restore();
  await main.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Course", { exact: true })).toHaveValue(course.id);
  await expect(main.getByText(FAILED)).toHaveCount(0);
});
