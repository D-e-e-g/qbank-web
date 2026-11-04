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

function sata(id: string): Record<string, unknown> {
  return {
    id,
    type: "sata",
    topic: "Strike topic SATA",
    cj: "Analyze cues",
    stem: "Invented stem for a select-all question.",
    ask: "Which findings need follow-up?",
    options: [
      { t: "Keep this finding", ok: true, why: "It belongs." },
      { t: "Skip this finding", why: "It does not belong." },
      { t: "Keep the other finding", ok: true, why: "It belongs too." },
    ],
    rationale: "Both kept findings need follow-up.",
    takeaway: "Follow up on findings that change care.",
    terms: [],
  };
}

/** A new course with one set in Week 1, imported through the API as she would from the Import screen. */
async function importSet(page: Page, title: string, questions: Record<string, unknown>[]): Promise<string> {
  const code = `S${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const response = await page.request.post("/api/imports", {
    data: {
      source: JSON.stringify({ title, desc: "Invented practice set.", terms: {}, questions }),
      folderName: "Week 1",
      newCourse: { code, title: `${code} strike-out`, semesterNumber: 1 },
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { courseId: string }).courseId;
}

/** The row of the choice with this text: the choice itself and its strike-out control. */
function row(page: Page, role: "radio" | "checkbox", name: string): { choice: Locator; strike: Locator; restore: Locator } {
  const choice = page.getByRole(role, { name, exact: true });
  const container = page.locator(".choice-row").filter({ has: choice });
  return {
    choice,
    strike: container.getByRole("button", { name: /^Strike out [A-Z]$/ }),
    restore: container.getByRole("button", { name: /^Restore [A-Z]$/ }),
  };
}

function strikeControls(page: Page): Locator {
  return page.getByRole("button", { name: /^(Strike out|Restore) [A-Z]$/ });
}

/** Every answer posted while the test runs, to check that no strike ever leaves the page. */
function postedAnswers(page: Page): string[] {
  const bodies: string[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/attempts") bodies.push(request.postData() ?? "");
  });
  return bodies;
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

test.describe("striking out choices", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("in practice, a struck choice is unpicked and locked until restored, and the answer stays her own", async ({ page }, testInfo) => {
    await signIn(page);
    const posted = postedAnswers(page);
    const courseId = await importSet(page, "Strike-out practice", [single("Q1", "Strike topic 1"), sata("Q2")]);
    await page.goto(`/course/${courseId}`);
    await page.getByRole("link", { name: /^Week 1 / }).click();
    await page.getByRole("link", { name: "Strike-out practice" }).click();
    await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();

    // Striking the choice she picked unpicks it, crosses it out, and locks it.
    const wrong = row(page, "radio", WRONG);
    await wrong.choice.click();
    await expect(wrong.choice).toHaveAttribute("aria-checked", "true");
    // The control is a plain X, still named Strike out, not the S-with-a-line glyph.
    await expect(wrong.strike.locator("path")).toHaveCount(2);
    await expect(wrong.strike.locator("path").nth(0)).toHaveAttribute("d", "M18 6 6 18");
    await expect(wrong.strike.locator("path").nth(1)).toHaveAttribute("d", "m6 6 12 12");
    await wrong.strike.click();
    await expect(wrong.restore.locator("path").nth(0)).toHaveAttribute("d", "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8");
    await expect(wrong.restore.locator("path").nth(1)).toHaveAttribute("d", "M3 3v5h5");
    await expect(wrong.choice).toHaveAttribute("aria-checked", "false");
    await expect(wrong.choice).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(".choice-row-struck")).toHaveCount(1);
    await expect(page.locator(".choice-row-struck .choice-text")).toHaveCSS("text-decoration-line", "line-through");
    await expect(page.getByRole("button", { name: "Check answer" })).toBeDisabled();
    // A tap on the struck choice still reaches it (Playwright treats aria-disabled as disabled) and picks nothing.
    await wrong.choice.click({ force: true });
    await expect(wrong.choice).toHaveAttribute("aria-checked", "false");

    // The same control restores it, in one tap.
    await wrong.restore.click();
    await expect(wrong.choice).not.toHaveAttribute("aria-disabled");
    await expect(page.locator(".choice-row-struck")).toHaveCount(0);
    await wrong.strike.click();

    const other = row(page, "radio", OTHER);
    if (testInfo.project.name === "desktop-chrome") {
      // A right-click strikes out too.
      await other.choice.click({ button: "right" });
      await expect(other.restore).toBeVisible();
    } else {
      await other.strike.click();
    }
    await expect(page.locator(".choice-row-struck")).toHaveCount(2);

    // Checking the answer shows the marks as before, with no strike left on any choice.
    await row(page, "radio", RIGHT).choice.click();
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByRole("status")).toContainText("Correct");
    await expect(strikeControls(page)).toHaveCount(0);
    await expect(page.locator(".choice-row-struck")).toHaveCount(0);
    await page.getByRole("button", { name: "Next question" }).click();

    // Select all that apply: striking one pick leaves the others, and a restored choice can be picked.
    await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
    await expect(page.locator(".choice-row-struck")).toHaveCount(0);
    const keep = row(page, "checkbox", "Keep this finding");
    const skip = row(page, "checkbox", "Skip this finding");
    await keep.choice.click();
    await skip.choice.click();
    await skip.strike.click();
    await expect(keep.choice).toHaveAttribute("aria-checked", "true");
    await expect(skip.choice).toHaveAttribute("aria-checked", "false");
    await skip.restore.click();
    await skip.choice.click();
    await expect(skip.choice).toHaveAttribute("aria-checked", "true");
    await skip.strike.click();
    await row(page, "checkbox", "Keep the other finding").choice.click();
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByRole("status")).toContainText("Correct");
    await page.getByRole("button", { name: "See results" }).click();
    await expect(page.getByRole("heading", { name: "2 of 2 fully right" })).toBeVisible();

    expect(posted).toHaveLength(2);
    for (const body of posted) expect(body).not.toMatch(/struck|strike/i);
  });

  test("in an exam, a strike stays on a skipped question until she restores it", async ({ page }) => {
    await signIn(page);
    const posted = postedAnswers(page);
    const courseId = await importSet(page, "Strike-out exam set", [single("Q1", "Strike topic 1"), single("Q2", "Strike topic 2")]);
    await page.goto(`/course/${courseId}/exam`);
    await page.getByRole("checkbox", { name: /^Week 1 / }).check();
    await page.getByRole("button", { name: "Start exam" }).click();
    await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();

    const firstTopic = (await page.locator(".runner-meta span").nth(1).textContent()) ?? "";
    await row(page, "radio", WRONG).strike.click();
    await expect(row(page, "radio", WRONG).choice).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: "Skip for now" }).click();

    // The next question opens with nothing struck.
    await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
    await expect(page.locator(".choice-row-struck")).toHaveCount(0);
    await row(page, "radio", RIGHT).choice.click();
    await page.getByRole("button", { name: "Submit and continue" }).click();

    // Back on the skipped question, her strike is still there, and one tap restores it.
    await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
    expect(await page.locator(".runner-meta span").nth(1).textContent()).toBe(firstTopic);
    const wrong = row(page, "radio", WRONG);
    await expect(wrong.restore).toBeVisible();
    await expect(page.locator(".choice-row-struck")).toHaveCount(1);
    await wrong.restore.click();
    await expect(page.locator(".choice-row-struck")).toHaveCount(0);
    await wrong.choice.click();
    await expect(wrong.choice).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Finish exam" }).last().click();

    await expect(page.getByRole("heading", { name: "1 of 2 fully right" })).toBeVisible();
    await expect(strikeControls(page)).toHaveCount(0);
    expect(posted).toHaveLength(2);
    for (const body of posted) expect(body).not.toMatch(/struck|strike/i);
  });
});
