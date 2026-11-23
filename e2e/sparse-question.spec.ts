import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signIn } from "./sign-in";

// A question may arrive with no stem, rationale or takeaway, and a choice question may have two options.
// A unit test cannot show that the real screens leave out the empty sections and their headings.
const RIGHT = "Sit the client upright";
const WRONG = "Leave the bed flat";

async function importSparseSet(page: Page): Promise<string> {
  const code = `S${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const question = {
    id: "Q1",
    type: "single",
    ask: "Which position helps breathing?",
    stem: "   ",
    options: [
      { t: RIGHT, ok: true, why: "Upright eases the work of breathing." },
      { t: WRONG, why: "Flat makes breathing harder." },
    ],
  };
  const response = await page.request.post("/api/imports", {
    data: {
      source: JSON.stringify({ title: "Sparse practice", desc: "Invented set.", terms: {}, questions: [question] }),
      folderName: "Week 1",
      newCourse: { code, title: `${code} sparse`, semesterNumber: 1 },
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { courseId: string }).courseId;
}

async function archiveCourses(page: Page): Promise<void> {
  const response = await page.request.get("/api/semesters");
  if (!response.ok()) return;
  const body = (await response.json()) as { semesters: { courses: { id: string; archivedAt: string | null }[] }[] };
  for (const semester of body.semesters) {
    for (const course of semester.courses) {
      if (course.archivedAt === null) await page.request.patch(`/api/courses/${course.id}`, { data: { archived: true } });
    }
  }
}

test.describe("a question with no stem, rationale or takeaway", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("shows its two options and no empty section, in practice and in the results", async ({ page }) => {
    await signIn(page);
    const courseId = await importSparseSet(page);
    await page.goto(`/course/${courseId}`);
    await page.getByRole("link", { name: /^Week 1 / }).click();
    await page.getByRole("link", { name: "Sparse practice" }).click();

    await expect(page.locator(".runner-ask")).toHaveText("Which position helps breathing?");
    await expect(page.locator(".runner-stem")).toHaveCount(0);
    await expect(page.locator(".choice")).toHaveCount(2);

    await page.locator(".choice").filter({ hasText: RIGHT }).click();
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.locator(".feedback-label")).toHaveText("Correct");
    await expect(page.locator(".runner-feedback")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rationale" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Key takeaway" })).toHaveCount(0);

    await page.getByRole("button", { name: "See results" }).click();
    await page.locator("summary", { hasText: "Single answer" }).click();
    const detail = page.locator(".result-detail");
    await expect(detail.locator("p")).toHaveCount(1);
    await expect(detail.locator("p").first()).toHaveText("Which position helps breathing?");
  });
});
