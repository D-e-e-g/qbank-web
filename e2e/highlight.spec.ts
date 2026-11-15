import type { Locator, Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures";
import { drag, middle, realFinger, steps, stroke } from "./gestures";
import { signIn } from "./sign-in";

const STEM = "At 2 PM the urine is cloudy and dark amber, 90 mL in the last 6 hours.";
// Long enough to wrap onto several lines and, on a phone, to make the question scroll.
const LONG_STEM = `${STEM} The client reports new confusion and chills since the morning, and the skin is cool and mottled over both knees. Capillary refill is 4 seconds. The indwelling catheter was placed three days ago after surgery, and the client has received two liters of fluid since admission without improvement in urine output.`;
const RIGHT = "Blood pressure 86/48 mm Hg";
const WRONG = "Temperature 37.9 degrees";
const OTHER = "Type 2 diabetes in the history";

function single(id: string, topic: string, stem = STEM): Record<string, unknown> {
  return {
    id,
    type: "single",
    topic,
    cj: "Recognize cues",
    stem,
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

function marks(scope: Locator): Locator {
  return scope.locator("mark.hl");
}

function choice(page: Page, name: string): Locator {
  return page.getByRole("radio", { name, exact: true });
}

async function openSet(page: Page, title: string, stem = STEM): Promise<void> {
  const courseId = await importSet(page, title, [single("Q1", "Highlight topic 1", stem), single("Q2", "Highlight topic 2", stem)]);
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
    });
    const posted = postedAnswers(page);
    await openSet(page, "Highlighting practice");
    const stem = page.locator(".runner-stem");
    // No hint line sits under the format line: the pen at its end is what shows highlighting is there.
    await expect(page.locator(".runner-hint")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Highlighter, / })).toBeVisible();

    // A drag across the stem marks the words it covers, in yellow.
    await drag(page, word(stem, "cloudy"), word(stem, "amber"));
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    await expect(marks(stem).first()).toHaveClass(/hl-yellow/);

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

  test("the eraser takes marks off by a drag, a color brings the pen back, and Clear highlights still clears", async ({ page }) => {
    await signIn(page);
    await openSet(page, "Highlighting eraser");
    const stem = page.locator(".runner-stem");
    const right = choice(page, RIGHT);
    const pen = page.getByRole("button", { name: /^Highlighter, / });
    await drag(page, word(stem, "cloudy"), word(stem, "amber"));
    await drag(page, word(right, "Blood"), word(right, "pressure"));
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    await expect(marks(right)).toHaveText(["Blood pressure"]);

    // The eraser sits in the pen's tray after the colors. Picking it closes the tray and shows on the pen.
    await pen.click();
    await expect(page.getByRole("group", { name: "Highlighter colors and eraser" }).getByRole("button")).toHaveText(["1", "2", "3", "", "Clear"]);
    const eraser = page.getByRole("button", { name: "Eraser", exact: true });
    await expect(eraser).toHaveAttribute("aria-pressed", "false");
    await eraser.click();
    await expect(pen).toHaveAccessibleName("Highlighter, eraser");
    await expect(pen).toHaveAttribute("aria-expanded", "false");

    // A drag with the eraser clears the marks under it and keeps the rest of a mark it cuts through.
    await drag(page, word(stem, "dark"), word(stem, "amber"));
    await expect(marks(stem)).toHaveText(["cloudy and"]);
    // Over plain words it marks nothing.
    await drag(page, word(stem, "last"), word(stem, "hours"));
    await expect(marks(stem)).toHaveText(["cloudy and"]);
    // On an answer it clears the mark and does not pick the answer.
    await drag(page, word(right, "Blood"), word(right, "Hg"));
    await expect(marks(right)).toHaveCount(0);
    await expect(right).toHaveAttribute("aria-checked", "false");
    // A click on a mark still erases the whole mark.
    await word(stem, "cloudy").click();
    await expect(marks(stem)).toHaveCount(0);

    // The eraser stays out on this device, as the pen's color does.
    await page.reload();
    await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
    await expect(pen).toHaveAccessibleName("Highlighter, eraser");
    await pen.click();
    await expect(eraser).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Clear highlights" })).toHaveCount(0);

    // Picking a color goes back to highlighting.
    await page.getByRole("button", { name: "Blue", exact: true }).click();
    await expect(pen).toHaveAccessibleName("Highlighter, blue");
    await drag(page, word(stem, "cloudy"), word(stem, "amber"));
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    await expect(marks(stem).first()).toHaveClass(/hl-blue/);
    // So do keys 1, 2 and 3.
    await pen.click();
    await eraser.click();
    await page.keyboard.press("3");
    await expect(pen).toHaveAccessibleName("Highlighter, pink");

    // Clear highlights still takes every mark off the question.
    await drag(page, word(right, "Blood"), word(right, "pressure"));
    await pen.click();
    await page.getByRole("button", { name: "Clear highlights" }).click();
    await expect(page.locator(".runner-column mark.hl")).toHaveCount(0);
  });

  test("a finger highlights by swiping along the words and not by swiping down them, a pencil in any direction, and a tap still picks", async ({ page }, testInfo) => {
    await signIn(page);
    await openSet(page, "Highlighting by touch", LONG_STEM);
    const stem = page.locator(".runner-stem");
    const cloudy = await middle(word(stem, "cloudy"));
    const amber = await middle(word(stem, "amber"));
    const mottled = await middle(word(stem, "mottled"));
    // The stem wraps, so "mottled" is on a line below "cloudy": straight down from "cloudy" to
    // that line, then along it, ends on "mottled" however wide the screen is.
    expect(mottled.y).toBeGreaterThan(cloudy.y + 10);
    const below = { x: cloudy.x, y: mottled.y };
    const down = [...steps(cloudy, below), ...steps(below, mottled)];
    const toMottled = LONG_STEM.slice(LONG_STEM.indexOf("cloudy"), LONG_STEM.indexOf("mottled") + "mottled".length);

    // A finger's swipe down the words is a scroll: it marks nothing, wherever it goes next.
    await stroke(page, "touch", word(stem, "cloudy"), steps(cloudy, { x: cloudy.x + 4, y: cloudy.y + 160 }));
    await stroke(page, "touch", word(stem, "cloudy"), down);
    await expect(marks(stem)).toHaveCount(0);
    // So is a slanted one.
    await stroke(page, "touch", word(stem, "cloudy"), steps(cloudy, { x: cloudy.x + 60, y: cloudy.y + 60 }));
    await expect(marks(stem)).toHaveCount(0);
    // Its swipe along the words marks them at once, with no hold, in either direction.
    await stroke(page, "touch", word(stem, "cloudy"), steps(cloudy, amber));
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    await word(stem, "cloudy").click();
    await expect(marks(stem)).toHaveCount(0);
    await stroke(page, "touch", word(stem, "amber"), steps(amber, cloudy));
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    // Once it marks, it keeps marking wherever it goes next, down the lines too.
    await stroke(page, "touch", word(stem, "cloudy"), [...steps(cloudy, amber), ...steps(amber, mottled)]);
    await expect(marks(stem)).toHaveText([toMottled]);

    // A swipe that starts beside the words marks nothing.
    await page.getByRole("button", { name: /^Highlighter, / }).click();
    await page.getByRole("button", { name: "Clear highlights" }).click();
    const beside = await page.locator(".runner-stem").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.left + 20, y: box.bottom + 4 };
    });
    await stroke(page, "touch", page.locator(".runner-column"), [beside, ...steps(beside, { x: beside.x + 200, y: beside.y })]);
    await expect(page.locator(".runner-column mark.hl")).toHaveCount(0);

    // Resting on a word first changes nothing: down the words still scrolls, along them still marks.
    await stroke(page, "touch", word(stem, "cloudy"), down, 700);
    await expect(marks(stem)).toHaveCount(0);
    await stroke(page, "touch", word(stem, "cloudy"), steps(cloudy, amber), 700);
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    await word(stem, "cloudy").click();
    await expect(marks(stem)).toHaveCount(0);

    // A pencil marks at once in any direction: straight down the lines, where a finger scrolls.
    await stroke(page, "pen", word(stem, "cloudy"), down);
    await expect(marks(stem)).toHaveText([toMottled]);

    // On an answer a finger's swipe marks and does not pick; a tap still picks.
    const right = choice(page, RIGHT);
    await stroke(page, "touch", word(right, "Blood"), steps(await middle(word(right, "Blood")), await middle(word(right, "pressure"))));
    await expect(marks(right)).toHaveText(["Blood pressure"]);
    await expect(right).toHaveAttribute("aria-checked", "false");
    const letter = right.locator(".choice-letter");
    if (testInfo.project.name === "iphone-safari") await letter.tap();
    else await letter.click();
    await expect(right).toHaveAttribute("aria-checked", "true");

    // The eraser follows the same rules: a finger's swipe along marked words clears them.
    await page.getByRole("button", { name: /^Highlighter, / }).click();
    await page.getByRole("button", { name: "Eraser", exact: true }).click();
    await stroke(page, "touch", word(stem, "cloudy"), steps(cloudy, { x: cloudy.x + 4, y: cloudy.y + 160 }));
    await expect(marks(stem)).toHaveCount(1);
    await stroke(page, "touch", word(stem, "cloudy"), steps(cloudy, amber));
    await expect(marks(stem)).toHaveText([LONG_STEM.slice(LONG_STEM.indexOf("90 mL"), LONG_STEM.indexOf("mottled") + "mottled".length)]);
  });

  test.describe("under a real finger on a phone", () => {
    test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

    test("a swipe along the words marks them and the page stays still; a swipe down the words, or beside them, scrolls and marks nothing", async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "a real touch is sent through Chromium");
      await signIn(page);
      await openSet(page, "Highlighting by a real finger", LONG_STEM);
      const stem = page.locator(".runner-stem");
      const scroller = page.locator(".runner-scroll");
      const scrolled = () => scroller.evaluate((element) => element.scrollTop);
      // Back to the top once the page has come to rest.
      const rest = async () => {
        let last = -1;
        await expect
          .poll(async () => {
            const before = last;
            last = await scrolled();
            return last === before;
          })
          .toBe(true);
        await scroller.evaluate((element) => {
          element.scrollTo(0, 0);
        });
      };
      // The question is taller than the screen, so there is something to scroll.
      expect(await scroller.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(150);
      const swipe = await realFinger(page);
      const cloudy = await middle(word(stem, "cloudy"));
      const amber = await middle(word(stem, "amber"));
      await rest();

      // Along the words: they are marked at once, and the page has not moved.
      await swipe(cloudy, amber);
      await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
      expect(await scrolled()).toBe(0);

      // Up the page from a word: the question scrolls, and no word is marked.
      const confusion = await middle(word(stem, "confusion"));
      expect(await scrolled()).toBe(0);
      await swipe(confusion, { x: confusion.x + 6, y: confusion.y - 160 });
      await expect.poll(scrolled).toBeGreaterThan(50);
      await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
      await rest();

      // Up the page from beside the words, in the gap under the stem: the question scrolls.
      const gap = await stem.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.left + 40, y: box.bottom + 5 };
      });
      expect(await scrolled()).toBe(0);
      await swipe(gap, { x: gap.x, y: gap.y - 160 });
      await expect.poll(scrolled).toBeGreaterThan(50);
      await expect(page.locator(".runner-column mark.hl")).toHaveText(["cloudy and dark amber"]);
      await rest();

      // The eraser under the same finger: along marked words it clears them, and the page stays still.
      await page.getByRole("button", { name: /^Highlighter, / }).tap();
      await page.getByRole("button", { name: "Eraser", exact: true }).tap();
      await swipe(await middle(word(stem, "dark")), await middle(word(stem, "amber")));
      await expect(marks(stem)).toHaveText(["cloudy and"]);
      expect(await scrolled()).toBe(0);
    });
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
    const firstTopic = (await page.locator(".runner-topic").textContent()) ?? "";
    await drag(page, word(stem, "cloudy"), word(stem, "amber"));
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
    await expect(page.locator(".runner-column mark.hl")).toHaveCount(0);
    await expect(strip.nth(0)).toHaveClass(/runner-strip-skipped/);
    await choice(page, RIGHT).click();
    await page.getByRole("button", { name: "Submit and continue" }).click();

    await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
    expect(await page.locator(".runner-topic").textContent()).toBe(firstTopic);
    await expect(marks(stem)).toHaveText(["cloudy and dark amber"]);
    await expect(strip.nth(1)).toHaveClass(/runner-strip-answered/);
    await choice(page, RIGHT).click();
    await page.getByRole("button", { name: "Finish exam" }).last().click();

    await expect(page.getByRole("heading", { name: "2 of 2 fully right" })).toBeVisible();
    await expect(page.locator("mark.hl")).toHaveCount(0);
  });
});
