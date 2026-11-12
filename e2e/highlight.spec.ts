import type { Locator, Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signIn } from "./sign-in";

const STEM = "At 2 PM the urine is cloudy and dark amber, 90 mL in the last 6 hours.";
const RIGHT = "Blood pressure 86/48 mm Hg";
const WRONG = "Temperature 37.9 degrees";
const OTHER = "Type 2 diabetes in the history";

function single(id: string, topic: string): Record<string, unknown> {
  return {
    id,
    type: "single",
    topic,
    cj: "Recognize cues",
    stem: STEM,
    ask: "Which finding needs follow-up right away?",
    table: { caption: "Vital signs", head: ["Time", "BP"], rows: [["8 AM", "118/70"], ["4 PM", "86/48"]] },
    options: [
      { t: RIGHT, ok: true, why: "Low pressure with poor perfusion." },
      { t: WRONG, why: "Within the usual range." },
      { t: OTHER, why: "Not new." },
    ],
    rationale: "The pressure points to poor perfusion.",
    takeaway: "Act on the finding that changes care.",
    terms: [],
  };
}

/** A new course with one set in Week 1, imported through the API as from the Import screen. */
async function importSet(page: Page, title: string, questions: Record<string, unknown>[]): Promise<string> {
  const code = `H${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const response = await page.request.post("/api/imports", {
    data: {
      source: JSON.stringify({ title, desc: "Invented practice set.", terms: {}, questions }),
      folderName: "Week 1",
      newCourse: { code, title: `${code} highlighting`, semesterNumber: 1 },
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

/** Every answer posted while the test runs, to check that no mark ever leaves the page. */
function postedAnswers(page: Page): string[] {
  const bodies: string[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/attempts") bodies.push(request.postData() ?? "");
  });
  return bodies;
}

/** The span of one word in a piece of markable text. */
function word(scope: Locator, text: string): Locator {
  return scope.locator("[data-i]").filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`) }).first();
}

/** Press on the first word, drag to the last, let go: the mouse version of the gesture. */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error("the words are not on screen");
  await page.mouse.move(start.x + 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 2, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
}

/** A touch and hold on `from`, a drag to `to`, and a lift, as a finger does it. `holdMs` 0 is a quick swipe. */
async function touchDrag(page: Page, from: Locator, to: Locator, holdMs: number): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error("the words are not on screen");
  const target = await from.elementHandle();
  await page.evaluate(
    ({ element, x, y }) => {
      element?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0 }));
    },
    { element: target, x: start.x + 2, y: start.y + start.height / 2 },
  );
  await page.waitForTimeout(holdMs);
  await page.evaluate(
    ({ x, y }) => {
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y }));
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y }));
    },
    { x: end.x + end.width - 2, y: end.y + end.height / 2 },
  );
}

function marks(scope: Locator): Locator {
  return scope.locator("mark.hl");
}

function choice(page: Page, name: string): Locator {
  return page.getByRole("radio", { name, exact: true });
}

async function openSet(page: Page, title: string): Promise<void> {
  const courseId = await importSet(page, title, [single("Q1", "Highlight topic 1"), single("Q2", "Highlight topic 2")]);
  await page.goto(`/course/${courseId}`);
  await page.getByRole("link", { name: /^Week 1 / }).click();
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
}

test.describe("highlighting a question", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("in practice, a drag marks words, a click on a mark erases it, and the marks stay until the set ends", async ({ page }) => {
    await signIn(page);
    await page.evaluate(() => {
      localStorage.removeItem("qbank.highlighter.color");
      localStorage.removeItem("qbank.highlighter.used");
    });
    const posted = postedAnswers(page);
    await openSet(page, "Highlighting practice");
    const stem = page.locator(".runner-stem");
    const hint = page.locator(".runner-hint");
    await expect(hint).toBeVisible();

    // A drag across the stem marks the words it covers, in yellow, and the hint goes.
    await drag(page, word(stem, "cloudy"), word(stem, "amber"));
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    await expect(marks(stem).first()).toHaveClass(/hl-yellow/);
    await expect(hint).toHaveCount(0);

    // A drag on an answer marks its words and does not pick it; a plain click still picks.
    const right = choice(page, RIGHT);
    await drag(page, word(right, "86"), word(right, "48"));
    await expect(marks(right)).toHaveText(["86/48"]);
    await expect(right).toHaveAttribute("aria-checked", "false");
    // Away from the mark: a click on the mark itself would erase it.
    await right.locator(".choice-letter").click();
    await expect(right).toHaveAttribute("aria-checked", "true");

    // The pen switches color from its menu, and keys 1, 2 and 3 switch it too.
    const pen = page.getByRole("button", { name: /^Highlighter, / });
    await expect(pen).toHaveAccessibleName("Highlighter, yellow");
    await pen.click();
    await expect(pen).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "Blue", exact: true }).click();
    await expect(pen).toHaveAccessibleName("Highlighter, blue");
    await expect(pen).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("3");
    await expect(pen).toHaveAccessibleName("Highlighter, pink");
    await page.keyboard.press("2");
    await expect(pen).toHaveAccessibleName("Highlighter, blue");

    // Dragging over a mark with another color repaints what it covers.
    await drag(page, word(stem, "dark"), word(stem, "amber"));
    await expect(marks(stem)).toHaveText(["cloudy and ", "dark amber"]);
    await expect(marks(stem).nth(1)).toHaveClass(/hl-blue/);

    // A table cell takes a mark too.
    const cell = page.locator(".exhibit-table td").filter({ hasText: /^86\/48$/ });
    await drag(page, word(cell, "86"), word(cell, "48"));
    await expect(marks(cell)).toHaveText(["86/48"]);

    // A click on a mark erases it, and on an answer it picks nothing.
    await word(stem, "cloudy").click();
    await expect(marks(stem)).toHaveText(["dark amber"]);
    const other = choice(page, OTHER);
    await drag(page, word(other, "Type"), word(other, "diabetes"));
    await expect(marks(other)).toHaveText(["Type 2 diabetes"]);
    await word(other, "diabetes").click();
    await expect(marks(other)).toHaveCount(0);
    await expect(other).toHaveAttribute("aria-checked", "false");
    await expect(right).toHaveAttribute("aria-checked", "true");

    // A struck-out answer keeps its marks, dimmed with it.
    const wrong = choice(page, WRONG);
    await drag(page, word(wrong, "Temperature"), word(wrong, "Temperature"));
    await page.getByRole("button", { name: /^Strike out [A-Z]$/ }).and(page.locator(".choice-row").filter({ has: wrong }).locator(".choice-strike")).click();
    await expect(page.locator(".choice-row-struck mark.hl")).toHaveText(["Temperature"]);
    await expect(page.locator(".choice-row-struck mark.hl")).toHaveCSS("opacity", "0.55");

    // Clear highlights, inside the pen, takes every mark off this question.
    await pen.click();
    await page.getByRole("button", { name: "Clear highlights" }).click();
    await expect(page.locator(".runner-column mark.hl")).toHaveCount(0);
    await pen.click();
    await expect(page.getByRole("button", { name: "Clear highlights" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(pen).toHaveAttribute("aria-expanded", "false");

    // Marks made before Check answer stay beside the rationale, which cannot be marked.
    await drag(page, word(stem, "urine"), word(stem, "cloudy"));
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByRole("status")).toContainText("Correct");
    await expect(marks(stem)).toHaveText(["urine is cloudy"]);
    await expect(page.locator(".runner-feedback .markable")).toHaveCount(0);

    // The next question starts clean, in the pen's color.
    await page.getByRole("button", { name: "Next question" }).click();
    await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
    await expect(page.locator(".runner-column mark.hl")).toHaveCount(0);
    await drag(page, word(stem, "hours"), word(stem, "hours"));
    await expect(marks(stem).first()).toHaveClass(/hl-blue/);
    await choice(page, RIGHT).click();
    await page.getByRole("button", { name: "Check answer" }).click();
    await page.getByRole("button", { name: "See results" }).click();

    // Results show each question clean.
    await expect(page.getByRole("heading", { name: "2 of 2 fully right" })).toBeVisible();
    await page.locator(".result-question summary").first().click();
    await expect(page.locator(".result-detail .runner-prose").first()).toHaveText(STEM);
    await expect(page.locator("mark.hl")).toHaveCount(0);
    expect(posted).toHaveLength(2);
    for (const body of posted) expect(body).not.toMatch(/mark|highlight/i);
  });

  test("marks last for this attempt in this browser: a reload drops them, and the pen keeps its color", async ({ page }) => {
    await signIn(page);
    await openSet(page, "Highlighting reload");
    const stem = page.locator(".runner-stem");
    await page.keyboard.press("3");
    await drag(page, word(stem, "cloudy"), word(stem, "amber"));
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    await page.reload();
    await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
    await expect(page.locator(".runner-column mark.hl")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Highlighter, / })).toHaveAccessibleName("Highlighter, pink");
  });

  test("on a touch screen, touch and hold marks, a quick swipe does not, and a tap still picks", async ({ page }, testInfo) => {
    await signIn(page);
    await openSet(page, "Highlighting by touch");
    const stem = page.locator(".runner-stem");
    // A swipe that moves at once scrolls; it marks nothing.
    await touchDrag(page, word(stem, "cloudy"), word(stem, "amber"), 0);
    await expect(marks(stem)).toHaveCount(0);
    // Holding first, then dragging, marks.
    await touchDrag(page, word(stem, "cloudy"), word(stem, "amber"), 700);
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    const right = choice(page, RIGHT);
    await touchDrag(page, word(right, "Blood"), word(right, "pressure"), 700);
    await expect(marks(right)).toHaveText(["Blood pressure"]);
    await expect(right).toHaveAttribute("aria-checked", "false");
    const letter = right.locator(".choice-letter");
    if (testInfo.project.name === "iphone-safari") await letter.tap();
    else await letter.click();
    await expect(right).toHaveAttribute("aria-checked", "true");
  });

  test("in an exam, a skipped question keeps its marks, and the result shows the question clean", async ({ page }) => {
    await signIn(page);
    const courseId = await importSet(page, "Highlighting exam", [single("Q1", "Highlight exam 1"), single("Q2", "Highlight exam 2")]);
    await page.goto(`/course/${courseId}/exam`);
    await page.getByRole("checkbox", { name: /^Week 1 / }).check();
    await page.getByRole("button", { name: "Start exam" }).click();
    await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
    const strip = page.locator(".runner-strip-step");
    await expect(strip).toHaveCount(2);
    await expect(strip.nth(0)).toHaveClass(/runner-strip-now/);

    const stem = page.locator(".runner-stem");
    const firstTopic = (await page.locator(".runner-meta span").nth(1).textContent()) ?? "";
    await drag(page, word(stem, "cloudy"), word(stem, "amber"));
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
    await expect(page.locator(".runner-column mark.hl")).toHaveCount(0);
    await expect(strip.nth(0)).toHaveClass(/runner-strip-skipped/);
    await choice(page, RIGHT).click();
    await page.getByRole("button", { name: "Submit and continue" }).click();

    await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
    expect(await page.locator(".runner-meta span").nth(1).textContent()).toBe(firstTopic);
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    await expect(strip.nth(1)).toHaveClass(/runner-strip-answered/);
    await choice(page, RIGHT).click();
    await page.getByRole("button", { name: "Finish exam" }).last().click();

    await expect(page.getByRole("heading", { name: "2 of 2 fully right" })).toBeVisible();
    await expect(page.locator("mark.hl")).toHaveCount(0);
  });
});
