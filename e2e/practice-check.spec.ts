import type { Locator, Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signIn } from "./sign-in";

const RIGHT = "The useful action";
const WRONG = "A distractor";
const OTHER = "Another distractor";

function single(id: string, topic: string): Record<string, unknown> {
  return {
    id,
    type: "single",
    topic,
    cj: "Take action",
    stem: `Invented stem for ${topic}.`,
    ask: "Which action comes first?",
    options: [
      { t: RIGHT, ok: true, why: "It addresses the finding." },
      { t: WRONG, why: "It does not change the finding." },
      { t: OTHER, why: "It does not change the finding either." },
    ],
    rationale: "The useful action matches the finding.",
    takeaway: "Match the action to the finding.",
    terms: [],
  };
}

/** A new course with one set in Week 1, imported through the API as from the Import screen. */
async function importSet(page: Page, title: string, questions: Record<string, unknown>[]): Promise<string> {
  const code = `K${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const response = await page.request.post("/api/imports", {
    data: {
      source: JSON.stringify({ title, desc: "Invented practice set.", terms: {}, questions }),
      folderName: "Week 1",
      newCourse: { code, title: `${code} checking`, semesterNumber: 1 },
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
      if (course.archivedAt !== null) continue;
      await page.request.patch(`/api/courses/${course.id}`, { data: { archived: true } });
    }
  }
}

/** The choice with this text. By its text, not its name: once checked, the name also carries the mark and the reason. */
function choice(page: Page, text: string): Locator {
  return page.locator(".choice").filter({ has: page.locator(".choice-text", { hasText: new RegExp(`^${text}$`) }) });
}

function strikeControl(page: Page, text: string): Locator {
  return page.locator(".choice-row").filter({ has: choice(page, text) }).getByRole("button", { name: /^Strike out [A-Z]$/ });
}

/** Every answer posted while the test runs. */
function postedAnswers(page: Page): string[] {
  const bodies: string[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/attempts") bodies.push(request.postData() ?? "");
  });
  return bodies;
}

test.describe("a practice answer being checked", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("stays as it was sent while its score is on its way, so the score is shown over the answer the server saved", async ({ page }) => {
    await signIn(page);
    const posted = postedAnswers(page);
    const courseId = await importSet(page, "Checking practice", [single("Q1", "Checking topic 1"), single("Q2", "Checking topic 2")]);
    await page.goto(`/course/${courseId}`);
    await page.getByRole("link", { name: /^Week 1 / }).click();
    await page.getByRole("link", { name: "Checking practice" }).click();
    await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();

    // The first try is lost on the way, and the retry is held: a slow connection, for as long as the test needs.
    let tries = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/attempts", async (route) => {
      tries += 1;
      if (tries === 1) {
        await route.abort("connectionreset");
        return;
      }
      await held;
      await route.continue();
    });

    await choice(page, WRONG).click();
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByText("No connection. Your answer is saved as soon as you are back online.")).toBeVisible();
    await expect.poll(() => tries).toBe(2);

    // Nothing about the answer changes while its score is on its way: not the pick, not a strike, not the guess box.
    await choice(page, RIGHT).click();
    await expect(choice(page, WRONG)).toHaveAttribute("aria-checked", "true");
    await expect(choice(page, RIGHT)).toHaveAttribute("aria-checked", "false");
    await strikeControl(page, WRONG).click();
    await strikeControl(page, OTHER).click();
    await expect(page.locator(".choice-row-struck")).toHaveCount(0);
    await expect(choice(page, WRONG)).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("checkbox", { name: /I'm guessing/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Check answer" })).toBeDisabled();

    // The reply lands: the server's score for the wrong choice, over the wrong choice.
    release();
    await expect(page.locator(".feedback-label")).toHaveText("Not correct");
    await expect(page.getByText("No connection.", { exact: false })).toBeHidden();
    await expect(choice(page, WRONG)).toHaveClass(/choice-wrong/);
    await expect(choice(page, RIGHT)).toHaveClass(/choice-missed/);
    await expect(page.getByRole("checkbox", { name: /I'm guessing/ })).toHaveCount(0);

    // One answer, sent twice with the same id, never the pick tapped during the wait.
    expect(posted).toHaveLength(2);
    expect(posted[1]).toBe(posted[0]);
    await page.unroute("**/api/attempts");

    // The next question is open again and takes an answer as before.
    await page.getByRole("button", { name: "Next question" }).click();
    await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
    await choice(page, WRONG).click();
    await choice(page, RIGHT).click();
    await expect(choice(page, RIGHT)).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.locator(".feedback-label")).toHaveText("Correct");
    await expect(choice(page, RIGHT)).toHaveClass(/choice-correct/);
    await page.getByRole("button", { name: "See results" }).click();
    await expect(page.getByRole("heading", { name: "1 of 2 fully right" })).toBeVisible();
    expect(posted).toHaveLength(3);
  });
});
