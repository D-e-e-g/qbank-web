import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ADMIN_EMAIL, ADMIN_PASSWORD, signIn } from "./sign-in";

// A practice set remembers where she left it, on the server: it opens at the first question she has
// not answered, on any device, and Start over begins it again. Her answers are never touched.

const RIGHT = "The useful action";
const WRONG = "A distractor";

interface Imported {
  courseId: string;
  folderId: string;
  setId: string;
  questionIds: string[];
  title: string;
}

function courseCode(): string {
  return `S${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function bank(title: string, count: number): string {
  return JSON.stringify({
    title,
    desc: "Invented practice set.",
    terms: {},
    questions: Array.from({ length: count }, (_, index) => ({
      id: `Q${String(index + 1)}`,
      type: "single",
      topic: `Topic ${String(index + 1)}`,
      stem: `Invented stem ${String(index + 1)}.`,
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

async function importSet(page: Page, count: number): Promise<Imported> {
  const code = courseCode();
  const title = "Shock and perfusion";
  const imported = await page.request.post("/api/imports", {
    data: { source: bank(title, count), folderName: "Week 6", newCourse: { code, title: `${code} progress`, semesterNumber: 1 } },
  });
  expect(imported.status()).toBe(201);
  const { courseId } = (await imported.json()) as { courseId: string };
  const detail = await page.request.get(`/api/courses/${courseId}`);
  const course = (await detail.json()) as { folders: { id: string; sets: { id: string; questionIds: string[] }[] }[] };
  const folder = course.folders[0];
  const set = folder?.sets[0];
  if (!folder || !set) throw new Error("the import made no set");
  return { courseId, folderId: folder.id, setId: set.id, questionIds: set.questionIds, title };
}

/**
 * Saves an answer the way one from before sittings stands: on her progress, in no sitting. A Review
 * answer is the one kind that never opens a sitting, so this is how the first day looks on the server.
 */
async function answerBeforeSittings(page: Page, questionId: string | undefined, choice = 0): Promise<void> {
  const response = await page.request.post("/api/attempts", {
    data: { clientAttemptId: crypto.randomUUID(), questionId, response: { type: "single", choice }, guessed: false, fromReview: true },
  });
  expect(response.status()).toBe(201);
}

function folderPage(set: Imported): string {
  return `/course/${set.courseId}/folder/${set.folderId}`;
}

function setRow(page: Page, set: Imported) {
  return page.getByRole("link", { name: new RegExp(`^${set.title}`) });
}

/** The question on screen, by its place in the set and its stem, which is numbered the same. */
async function expectOnQuestion(page: Page, place: number, of: number): Promise<void> {
  await expect(page.getByText(`${String(place)} of ${String(of)}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`Invented stem ${String(place)}.`, { exact: true })).toBeVisible();
}

async function answerRight(page: Page): Promise<void> {
  await page.getByRole("radio", { name: RIGHT, exact: true }).click();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.locator(".feedback-label")).toHaveText("Correct");
}

async function answerAndGoOn(page: Page, count: number): Promise<void> {
  for (let done = 0; done < count; done += 1) {
    await answerRight(page);
    await page.getByRole("button", { name: /^(Next question|See results)$/ }).click();
  }
}

function progressBar(page: Page) {
  return page.getByRole("progressbar", { name: "Progress" });
}

function pickedUp(page: Page) {
  return page.locator(".runner-pickup");
}

const NEW_RUN_NOTICE = "You've answered this set before. Answering now starts a new practice run.";

function newRunNotice(page: Page) {
  return page.getByText(NEW_RUN_NOTICE, { exact: true });
}

/** Leaves the sample student's Home as the other specs found it. */
async function archiveCourses(page: Page): Promise<void> {
  const { request } = page.context();
  const response = await request.get("/api/semesters");
  if (!response.ok()) return;
  const body = (await response.json()) as { semesters: { courses: { id: string; archivedAt: string | null }[] }[] };
  for (const semester of body.semesters) {
    for (const course of semester.courses) {
      if (course.archivedAt === null) await request.patch(`/api/courses/${course.id}`, { data: { archived: true } });
    }
  }
}

test.describe("a set remembers where she left it", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("answers some, leaves every way she can, and comes back to the first unanswered question", async ({ page, browser }) => {
    await signIn(page);
    const set = await importSet(page, 6);

    await page.goto(folderPage(set));
    await expect(setRow(page, set)).toContainText("Imported today · 6 questions");
    await setRow(page, set).click();
    await expectOnQuestion(page, 1, 6);
    await expect(pickedUp(page)).toHaveCount(0);
    await expect(newRunNotice(page)).toHaveCount(0);

    // A practice answer says nothing about where it came from.
    const sent = page.waitForRequest((request) => request.url().endsWith("/api/attempts") && request.method() === "POST");
    await answerRight(page);
    expect((await sent).postDataJSON()).not.toHaveProperty("fromReview");
    await page.getByRole("button", { name: "Next question" }).click();
    await answerAndGoOn(page, 2);
    await expectOnQuestion(page, 4, 6);

    // Reload.
    await page.reload();
    await expectOnQuestion(page, 4, 6);
    await expect(pickedUp(page)).toContainText("Picked up at 4 · 3 answered earlier");
    await expect(pickedUp(page).getByRole("button", { name: "Start over" })).toBeVisible();
    await expect(newRunNotice(page)).toHaveCount(0);
    await expect(progressBar(page)).toHaveAttribute("aria-valuenow", "50");

    // Close the tab and open it again.
    const url = page.url();
    const reopened = await page.context().newPage();
    await page.close();
    await reopened.goto(url);
    await expectOnQuestion(reopened, 4, 6);

    // Close the runner, and tap the set's row.
    await reopened.getByRole("button", { name: "Close" }).click();
    await expect(setRow(reopened, set)).toContainText("3 of 6 answered · Continue");
    await setRow(reopened, set).click();
    await expectOnQuestion(reopened, 4, 6);

    // Her other device opens the same place.
    const otherContext = await browser.newContext();
    try {
      const other = await otherContext.newPage();
      await signIn(other);
      await other.goto(folderPage(set));
      await expect(setRow(other, set)).toContainText("3 of 6 answered · Continue");
      await setRow(other, set).click();
      await expectOnQuestion(other, 4, 6);
    } finally {
      await otherContext.close();
    }

    // The result at the end counts the answers from before she left.
    await answerAndGoOn(reopened, 3);
    await expect(reopened.getByRole("heading", { name: "6 of 6 fully right" })).toBeVisible();
    await expect(reopened.getByText("6 of 6 points", { exact: true })).toBeVisible();
    await expect(reopened.locator(".result-mark-correct")).toHaveCount(6);
  });

  test("Start over asks once, keeps every answer, and begins again at question 1", async ({ page }) => {
    await signIn(page);
    const set = await importSet(page, 5);
    await page.goto(folderPage(set));
    await setRow(page, set).click();
    await answerAndGoOn(page, 2);
    await page.reload();
    await expectOnQuestion(page, 3, 5);

    // Cancel changes nothing.
    const startOver = page.getByRole("button", { name: "Start over" });
    await startOver.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `Start over ${set.title}?` })).toBeVisible();
    await expect(dialog).toContainText("Your 2 answers stay saved and still count. The set begins again at question 1.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expectOnQuestion(page, 3, 5);

    await startOver.click();
    await dialog.getByRole("button", { name: "Start over" }).click();
    await expect(dialog).toBeHidden();
    await expectOnQuestion(page, 1, 5);
    await expect(pickedUp(page)).toHaveCount(0);
    await expect(newRunNotice(page)).toHaveCount(0);
    await expect(progressBar(page)).toHaveAttribute("aria-valuenow", "0");

    // Her answers stay, and the row goes back to saying only that.
    const detail = await page.request.get(`/api/courses/${set.courseId}`);
    expect(((await detail.json()) as { answeredCount: number; fullyRightCount: number })).toMatchObject({ answeredCount: 2, fullyRightCount: 2 });
    await page.getByRole("button", { name: "Close" }).click();
    await expect(setRow(page, set)).toContainText("2 of 5 answered");
    await expect(setRow(page, set)).not.toContainText("Continue");

    // It opens at 1 until she answers, and then remembers the new sitting.
    await setRow(page, set).click();
    await expectOnQuestion(page, 1, 5);
    await expect(pickedUp(page)).toHaveCount(0);
    await expect(newRunNotice(page)).toHaveCount(0);
    await answerAndGoOn(page, 1);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(setRow(page, set)).toContainText("1 of 5 answered · Continue");
    await setRow(page, set).click();
    await expectOnQuestion(page, 2, 5);
  });

  test("a finished set says Done and opens fresh, and answering it again is a retake", async ({ page }) => {
    await signIn(page);
    const set = await importSet(page, 3);
    await page.goto(folderPage(set));
    await setRow(page, set).click();
    await answerAndGoOn(page, 3);
    await expect(page.getByRole("heading", { name: "3 of 3 fully right" })).toBeVisible();

    await page.getByRole("button", { name: "Back to folder" }).click();
    await expect(setRow(page, set)).toContainText("Done today · 3 of 3 fully right");
    await expect(setRow(page, set)).not.toContainText("Continue");
    await setRow(page, set).click();
    await expectOnQuestion(page, 1, 3);
    await expect(pickedUp(page)).toHaveCount(0);
    await expect(newRunNotice(page)).toBeVisible();
    await expect(page.getByRole("button", { name: NEW_RUN_NOTICE })).toHaveCount(0);

    await answerAndGoOn(page, 1);
    await expectOnQuestion(page, 2, 3);
    await expect(newRunNotice(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(setRow(page, set)).toContainText("1 of 3 answered · Continue");
  });

  test("on the first day, a set she is midway through continues from the answers already saved", async ({ page }) => {
    await signIn(page);
    const set = await importSet(page, 4);
    await answerBeforeSittings(page, set.questionIds[0]);
    await answerBeforeSittings(page, set.questionIds[1], 1);

    await page.goto(folderPage(set));
    await expect(setRow(page, set)).toContainText("2 of 4 answered · Continue");
    await setRow(page, set).click();
    await expectOnQuestion(page, 3, 4);
    await expect(pickedUp(page)).toContainText("Picked up at 3 · 2 answered earlier");

    // The answers from before count in the result, with the marks she got then.
    await answerAndGoOn(page, 2);
    await expect(page.getByRole("heading", { name: "3 of 4 fully right" })).toBeVisible();
    await expect(page.locator(".result-mark-incorrect")).toHaveCount(1);
    await expect(page.getByText("Not answered", { exact: true })).toHaveCount(0);
  });

  test("Start over on the first day ends a sitting that has no row yet", async ({ page }) => {
    await signIn(page);
    const set = await importSet(page, 3);
    await answerBeforeSittings(page, set.questionIds[0]);
    await page.goto(folderPage(set));
    await setRow(page, set).click();
    await expectOnQuestion(page, 2, 3);

    await page.getByRole("button", { name: "Start over" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Your 1 answer stays saved and still counts. The set begins again at question 1.");
    await dialog.getByRole("button", { name: "Start over" }).click();
    await expectOnQuestion(page, 1, 3);
    await page.reload();
    await expectOnQuestion(page, 1, 3);
    await expect(pickedUp(page)).toHaveCount(0);
    await expect(newRunNotice(page)).toHaveCount(0);
  });

  test("a question she already answered out of order is not asked again", async ({ page }) => {
    await signIn(page);
    const set = await importSet(page, 4);
    await answerBeforeSittings(page, set.questionIds[1]);

    await page.goto(folderPage(set));
    await setRow(page, set).click();
    await expectOnQuestion(page, 1, 4);
    await expect(pickedUp(page)).toContainText("Picked up at 1 · 1 answered earlier");
    await expect(newRunNotice(page)).toHaveCount(0);
    await expect(progressBar(page)).toHaveAttribute("aria-valuenow", "25");

    await answerRight(page);
    await expect(progressBar(page)).toHaveAttribute("aria-valuenow", "50");
    await page.getByRole("button", { name: "Next question" }).click();
    await expectOnQuestion(page, 3, 4);
    await answerAndGoOn(page, 1);
    await answerRight(page);
    await expect(page.getByRole("button", { name: "See results" })).toBeVisible();
  });

  test("a Review answer says so, and does not read as beginning a finished set again", async ({ page }) => {
    await signIn(page);
    const set = await importSet(page, 3);
    await page.goto(folderPage(set));
    await setRow(page, set).click();
    await page.getByRole("radio", { name: WRONG, exact: true }).click();
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.locator(".feedback-label")).toHaveText("Not correct");
    await page.getByRole("button", { name: "Next question" }).click();
    await answerAndGoOn(page, 2);
    await page.getByRole("button", { name: "Back to folder" }).click();
    await expect(setRow(page, set)).toContainText("Done today · 2 of 3 fully right");

    // The first question of a Done set is the one a Review answer would otherwise begin it again with.
    await page.goto(`/course/${set.courseId}/review/practice?question=${set.questionIds[0] ?? ""}`);
    await expect(page.getByText("Invented stem 1.", { exact: true })).toBeVisible();
    await expect(pickedUp(page)).toHaveCount(0);
    await expect(newRunNotice(page)).toHaveCount(0);
    const sent = page.waitForRequest((request) => request.url().endsWith("/api/attempts") && request.method() === "POST");
    await answerRight(page);
    expect((await sent).postDataJSON()).toMatchObject({ fromReview: true });

    await page.goto(folderPage(set));
    await expect(setRow(page, set)).toContainText("Done today · 3 of 3 fully right");
    await expect(setRow(page, set)).not.toContainText("Continue");
  });

  test("the admin sees how far she is, with nothing to continue", async ({ page, browser }) => {
    await signIn(page);
    const set = await importSet(page, 4);
    await page.goto(folderPage(set));
    await setRow(page, set).click();
    await answerAndGoOn(page, 1);

    const adminContext = await browser.newContext();
    try {
      const admin = await adminContext.newPage();
      await signIn(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
      await admin.goto(folderPage(set));
      const list = admin.getByRole("list", { name: "Sets in Week 6" });
      await expect(list).toContainText("1 of 4 answered");
      await expect(list).toContainText("Continue");
    } finally {
      await adminContext.close();
    }
  });
});
