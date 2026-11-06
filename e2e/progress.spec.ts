import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ADMIN_EMAIL, ADMIN_PASSWORD, signIn } from "./sign-in";

const RIGHT = "The useful action";
const WRONG = "A distractor";

/** One single-answer question per topic. The set is named after the first topic. */
function bank(topics: string[]): string {
  return JSON.stringify({
    title: `${topics[0] ?? "Invented"} set`,
    desc: "Invented practice set.",
    terms: {},
    questions: topics.map((topic, index) => ({
      id: `Q${String(index + 1)}`,
      type: "single",
      topic,
      stem: `Invented stem for ${topic}.`,
      ask: "Which action comes first?",
      options: [
        { t: RIGHT, ok: true, why: "It addresses the finding." },
        { t: WRONG, why: "It does not change the finding." },
        { t: "Another distractor", why: "It does not change the finding either." },
      ],
      rationale: "The useful action matches the finding.",
      takeaway: "Match the action to the finding.",
      terms: [],
    })),
  });
}

function courseCode(): string {
  return `R${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

async function importCourse(page: Page, code: string, topics: string[]): Promise<{ courseId: string; questionIds: string[] }> {
  const imported = await page.request.post("/api/imports", {
    data: {
      source: bank(topics),
      folderName: "Week 1",
      newCourse: { code, title: `${code} progress`, semesterNumber: 1 },
    },
  });
  expect(imported.status()).toBe(201);
  const created = (await imported.json()) as { courseId: string };
  const detail = await page.request.get(`/api/courses/${created.courseId}`);
  expect(detail.ok()).toBe(true);
  const course = (await detail.json()) as { folders: { sets: { questionIds: string[] }[] }[] };
  const questionIds = course.folders[0]?.sets[0]?.questionIds ?? [];
  expect(questionIds).toHaveLength(topics.length);
  return { courseId: created.courseId, questionIds };
}

async function answerWrongByApi(page: Page, questionId: string): Promise<void> {
  const response = await page.request.post("/api/attempts", {
    data: { clientAttemptId: crypto.randomUUID(), questionId, response: { type: "single", choice: 1 }, guessed: false },
  });
  expect(response.status()).toBe(201);
}

/** Opens the course's only set, from its folder, in the runner. */
async function openSet(page: Page, courseId: string, title: string): Promise<void> {
  await page.goto(`/course/${courseId}`);
  await page.getByRole("link", { name: /^Week 1 / }).click();
  await page.getByRole("link", { name: new RegExp(`^${title}`) }).click();
  await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
}

/** Picks an option, checks it, and waits for the server's mark. */
async function answer(page: Page, option: string, mark: "Correct" | "Not correct"): Promise<void> {
  await page.getByRole("radio", { name: option, exact: true }).click();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.locator(".feedback-label")).toHaveText(mark);
}

async function reviewCount(page: Page, courseId: string): Promise<number> {
  const response = await page.request.get(`/api/courses/${courseId}/review`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { counts: { all: number } }).counts.all;
}

/** Her saved answers, as the admin's repair preview counts them. */
async function savedAnswers(admin: Page): Promise<number> {
  const response = await admin.request.get("/api/admin/repair");
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { attemptCount: number }).attemptCount;
}

async function signedInPage(browser: Browser, email?: string, password?: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, password);
  return page;
}

async function archiveCourses(page: Page): Promise<void> {
  const response = await page.request.get("/api/semesters");
  if (!response.ok()) return;
  const body = (await response.json()) as { semesters: { courses: { id: string; archivedAt: string | null }[] }[] };
  for (const semester of body.semesters) {
    for (const course of semester.courses) {
      if (course.archivedAt !== null) continue;
      await page.request.patch(`/api/courses/${course.id}`, { data: { archived: true } });
    }
  }
}

test.describe("progress and review", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("Clear asks first, and Cancel leaves the list and the score", async ({ page }) => {
    const code = courseCode();
    await signIn(page);
    const { courseId, questionIds } = await importCourse(page, code, ["Fluids"]);
    await answerWrongByApi(page, questionIds[0] ?? "");

    await page.goto(`/course/${courseId}/review`);
    await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Fluids/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Practice these 1 (shuffled)" })).toBeVisible();

    await page.getByRole("button", { name: "Clear the review list" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Clear all 1 question from this course's Review list?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: /Fluids/ })).toBeVisible();
    expect(await reviewCount(page, courseId)).toBe(1);

    await page.getByRole("button", { name: "Clear the review list" }).click();
    await dialog.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("Questions you miss or flag as a guess show up here.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear the review list" })).toHaveCount(0);

    const course = await page.request.get(`/api/courses/${courseId}`);
    expect(((await course.json()) as { answeredCount: number }).answeredCount).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  });

  test("an answer in the runner on one browser is the same Review on another, and the admin cannot change it", async ({ browser, page }) => {
    const code = courseCode();
    const studentPage = await signedInPage(browser);
    const otherPage = await signedInPage(browser);
    const adminPage = await signedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    try {
      const { courseId } = await importCourse(studentPage, code, ["Perfusion"]);
      await openSet(studentPage, courseId, "Perfusion set");
      await answer(studentPage, WRONG, "Not correct");

      await otherPage.goto(`/course/${courseId}/review`);
      await expect(otherPage.getByRole("heading", { name: "Review" })).toBeVisible();
      await expect(otherPage.getByRole("button", { name: /Perfusion/ })).toBeVisible();
      expect(await reviewCount(otherPage, courseId)).toBe(1);

      await adminPage.goto(`/course/${courseId}/review`);
      await expect(adminPage.getByText("Viewing student@example.com")).toBeVisible();
      await expect(adminPage.getByText("Perfusion", { exact: true })).toBeVisible();
      await adminPage.getByRole("button", { name: "Clear the review list" }).click();
      await expect(adminPage.getByText("This is a frozen view of", { exact: false })).toBeVisible();
      await expect(adminPage.getByRole("dialog")).toHaveCount(0);
      await adminPage.getByRole("button", { name: /Practice these/ }).click();
      await adminPage.getByRole("radio", { name: WRONG, exact: true }).click();
      await adminPage.getByRole("button", { name: "Check answer" }).click();
      await expect(adminPage.getByText("This is a frozen view of", { exact: false })).toBeVisible();
      expect(await reviewCount(studentPage, courseId)).toBe(1);
      const adminPlace = (await (await adminPage.request.get("/api/me/place")).json()) as { courseId: string | null };
      expect(adminPlace.courseId).toBeNull();

      await adminPage.goto("/admin");
      await adminPage.getByRole("button", { name: /Rebuild progress and Review/ }).click();
      const dialog = adminPage.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Rebuild their progress and Review?" })).toBeVisible();
      expect(await dialog.locator(".sheet-message").innerText()).toContain("saved answer");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      expect(await reviewCount(studentPage, courseId)).toBe(1);

      await adminPage.getByRole("button", { name: /Rebuild progress and Review/ }).click();
      await dialog.getByRole("button", { name: "Rebuild" }).click();
      await expect(adminPage.getByText(/^Rebuilt just now from \d+ saved answers?$/)).toBeVisible();
      expect(await reviewCount(studentPage, courseId)).toBe(1);

      await studentPage.goto("/");
      await expect(studentPage).toHaveURL(new RegExp(`/course/${courseId}$`));
      await expect(studentPage.getByRole("heading", { name: code })).toBeVisible();
    } finally {
      await archiveCourses(studentPage);
      await studentPage.context().close();
      await otherPage.context().close();
      await adminPage.context().close();
    }
    await archiveCourses(page);
  });

  test("dropping the connection mid-answer records exactly one attempt", async ({ browser, page, context }) => {
    const code = courseCode();
    const adminPage = await signedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    try {
      await signIn(page);
      const { courseId } = await importCourse(page, code, ["Oxygenation", "Electrolytes"]);
      const before = await savedAnswers(adminPage);
      await openSet(page, courseId, "Oxygenation set");

      // The server saves the first answer, then the connection drops before the reply arrives.
      let cut = 0;
      await page.route("**/api/attempts", async (route) => {
        if (cut > 0) {
          await route.continue();
          return;
        }
        cut += 1;
        await route.fetch();
        await route.abort("connectionreset");
      });
      await page.getByRole("radio", { name: WRONG, exact: true }).click();
      await page.getByRole("button", { name: "Check answer" }).click();
      await expect(page.getByText("No connection. Your answer is saved as soon as you are back online.")).toBeVisible();
      await expect(page.locator(".feedback-label")).toHaveText("Not correct");
      await expect(page.getByText("No connection.", { exact: false })).toBeHidden();
      expect(cut).toBe(1);
      expect(await savedAnswers(adminPage)).toBe(before + 1);
      await page.unroute("**/api/attempts");

      // Offline before the answer leaves: it waits, then saves once when the device is back.
      await page.getByRole("button", { name: "Next question" }).click();
      await page.getByRole("radio", { name: RIGHT, exact: true }).click();
      await context.setOffline(true);
      await page.getByRole("button", { name: "Check answer" }).click();
      await expect(page.getByText("No connection. Your answer is saved as soon as you are back online.")).toBeVisible();
      await context.setOffline(false);
      await expect(page.locator(".feedback-label")).toHaveText("Correct");
      expect(await savedAnswers(adminPage)).toBe(before + 2);
      expect(await reviewCount(page, courseId)).toBe(1);
    } finally {
      await context.setOffline(false);
      await adminPage.context().close();
    }
  });

  test("Review opens the runner, and a fully right answer leaves Review", async ({ page }) => {
    const code = courseCode();
    await signIn(page);
    const { courseId, questionIds } = await importCourse(page, code, ["Mobility", "Nutrition", "Sleep"]);
    for (const id of questionIds) await answerWrongByApi(page, id);

    await page.goto(`/course/${courseId}/review`);
    await page.getByRole("button", { name: /Sleep/ }).click();
    await expect(page).toHaveURL(/\/review\/practice\?question=/);
    await expect(page.getByText("1 of 1")).toBeVisible();
    await expect(page.getByText("Invented stem for Sleep.")).toBeVisible();
    await answer(page, RIGHT, "Correct");
    await page.getByRole("button", { name: "See results" }).click();
    await expect(page.getByText(/^Review finished/)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/course/${courseId}/review$`));
    await expect(page.getByRole("button", { name: /Sleep/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Practice these 2 (shuffled)" }).click();
    await expect(page.getByText("1 of 2")).toBeVisible();
    await answer(page, RIGHT, "Correct");
    await page.getByRole("button", { name: "Next question" }).click();
    await page.getByRole("checkbox", { name: /I'm guessing/ }).check();
    await answer(page, RIGHT, "Correct");
    await page.getByRole("button", { name: "See results" }).click();
    await expect(page.getByRole("heading", { name: "2 of 2 fully right" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).first().click();

    // The guessed one stays in Review even though it was right.
    const rows = page.locator(".review-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Guessed");
    expect(await reviewCount(page, courseId)).toBe(1);
  });
});
