import type { Browser, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ADMIN_EMAIL, ADMIN_PASSWORD, signIn } from "./sign-in";

// An invented 48x24 PNG diagram: two filled boxes.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAIAAAAzn+mLAAAAPElEQVR42mP4P8gAw6iDhrSDauwTSEKjDhp1EK0cVHVmBklo1EGjDhp10KiDRh006iBqOWi0xTjqIDIAANczuddAgdT8AAAAAElFTkSuQmCC";
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect x="2" y="2" width="116" height="36" rx="6" fill="none" stroke="#7C3F60" stroke-width="2"/><text x="60" y="25" font-size="12" text-anchor="middle">Oxygen first</text></svg>';
const STEM_ALT = "Pulse oximeter trend from 0900 to 0930";
const RATIONALE_ALT = "Oxygen comes before reassessment";
const RIGHT = "Raise the head of the bed and apply oxygen";

/** A file with one question that has a wide readings table, a stem image, and a rationale image. */
function file(title: string): string {
  return JSON.stringify({
    title,
    desc: "Invented practice set with an exhibit.",
    terms: {},
    questions: [
      {
        id: "V1",
        type: "single",
        topic: "Trending SpO2",
        cj: "Recognize cues",
        need: "Reduction of Risk Potential",
        diff: 4,
        stem: "An invented client in the recovery unit has these readings.",
        table: {
          caption: "Recovery unit readings",
          head: ["Time", "SpO2", "HR", "RR", "BP", "Temp", "Pain", "Level of consciousness"],
          rows: [
            ["0900", "97%", 82, 16, "128/76", "36.8 C", "3/10", "Awake and talking"],
            ["0915", "93%", 94, 22, "122/74", "36.9 C", "4/10", "Drowsy, rouses to voice"],
            ["0930", "89%", 108, 26, "118/70", "37.0 C", "4/10", "Hard to rouse"],
          ],
        },
        images: [
          { src: PNG, alt: STEM_ALT, caption: "Oximeter trend" },
          { svg: SVG, alt: RATIONALE_ALT, at: "rationale" },
        ],
        ask: "Which action comes first?",
        options: [
          { t: RIGHT, ok: true, why: "The falling saturation needs oxygen now." },
          { t: "Recheck the readings in 30 minutes", why: "Waiting lets the client get worse." },
          { t: "Offer a warm blanket", why: "Comfort does not treat low oxygen." },
        ],
        rationale: "The saturation falls at each reading while the rate climbs.",
        takeaway: "A falling trend matters more than one reading.",
        terms: [],
        src: "Invented source",
      },
    ],
  });
}

function courseCode(): string {
  return `E${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

async function expectTable(scope: Page | Locator): Promise<void> {
  const table = scope.getByRole("table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "SpO2" })).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table.getByRole("row").nth(3)).toContainText("0930");
  await expect(table.getByRole("row").nth(3)).toContainText("89%");
}

/** The image is on screen and the browser decoded it. */
async function expectImage(scope: Page | Locator, alt: string): Promise<void> {
  const image = scope.getByRole("img", { name: alt, exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

async function overflows(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

async function signedInPage(browser: Browser, email: string, password: string): Promise<Page> {
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

test.describe("tables and images", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("she imports a file with a table and images and sees them on the phone", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "iphone-safari", "phone layout");
    const title = "Readings practice";
    await signIn(page);
    await page.goto("/import");
    await page.getByLabel("Paste JSON").fill(file(title));
    await page.getByLabel("Course code").fill(courseCode());
    await page.getByLabel("Course name").fill("Exhibits");
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByText("Ready: 1 question, 0 terms")).toBeVisible();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Imported" })).toBeVisible();
    await expect(page.getByText(`“${title}” · 1 question in`)).toBeVisible();
    await page.getByRole("link", { name: "Open Unsorted" }).click();
    await page.getByRole("link", { name: title }).click();

    await expect(page.getByText("1 of 1")).toBeVisible();
    await expectTable(page);
    await expect(page.getByText("Recovery unit readings")).toBeVisible();
    // The wide table scrolls inside its box; the page itself never scrolls sideways.
    const box = page.getByRole("region", { name: "Recovery unit readings" });
    expect(await box.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    expect(await overflows(page)).toBe(false);
    await expectImage(page, STEM_ALT);
    await expect(page.getByText("Oximeter trend")).toBeVisible();
    await expect(page.getByRole("img", { name: RATIONALE_ALT })).toHaveCount(0);

    await page.getByRole("button", { name: `Enlarge image: ${STEM_ALT}` }).click();
    const viewer = page.getByRole("dialog", { name: STEM_ALT });
    await expect(viewer).toBeVisible();
    await expectImage(viewer, STEM_ALT);
    await viewer.getByRole("button", { name: "Close" }).click();
    await expect(viewer).toBeHidden();
    // A tap on the empty space around the image also goes back.
    await page.getByRole("button", { name: `Enlarge image: ${STEM_ALT}` }).click();
    await expect(viewer).toBeVisible();
    await viewer.locator(".exhibit-viewer-frame").click({ position: { x: 5, y: 5 } });
    await expect(viewer).toBeHidden();

    await page.getByRole("radio", { name: RIGHT }).click();
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByRole("status")).toContainText("Correct");
    await expectImage(page, RATIONALE_ALT);
    expect(await overflows(page)).toBe(false);

    await page.getByRole("button", { name: "See results" }).click();
    await page.locator(".result-question summary").click();
    const detail = page.locator(".result-detail");
    await expectTable(detail);
    await expectImage(detail, STEM_ALT);
    await expectImage(detail, RATIONALE_ALT);
    expect(await overflows(page)).toBe(false);
  });

  test("the exam, its result, and the admin's read-only result show them", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "exam on desktop");
    await signIn(page);
    const imported = await page.request.post("/api/imports", {
      data: { source: file("Readings exam set"), folderName: "Week 1", newCourse: { code: courseCode(), title: "Exhibits", semesterNumber: 1 } },
    });
    expect(imported.status()).toBe(201);
    const { courseId } = (await imported.json()) as { courseId: string };

    await page.goto(`/course/${courseId}/exam`);
    await page.getByRole("checkbox", { name: /^Week 1 / }).check();
    await page.getByRole("button", { name: "Start exam" }).click();
    await expect(page.getByText("1 of 1", { exact: true })).toBeVisible();
    await expectTable(page);
    await expectImage(page, STEM_ALT);
    await expect(page.getByRole("img", { name: RATIONALE_ALT })).toHaveCount(0);
    await page.getByRole("radio", { name: RIGHT }).click();
    await page.getByRole("button", { name: "Finish exam" }).click();

    await expect(page.getByRole("heading", { name: "1 of 1 fully right" })).toBeVisible();
    await page.locator(".result-question summary").click();
    const detail = page.locator(".result-detail");
    await expectTable(detail);
    await expectImage(detail, STEM_ALT);
    await expectImage(detail, RATIONALE_ALT);

    const admin = await signedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    await admin.goto(`/course/${courseId}`);
    await admin.getByRole("link", { name: /^Exam/ }).click();
    await admin.getByRole("button", { name: /^Week 1 · today/ }).click();
    await expect(admin.getByRole("heading", { name: "1 of 1 fully right" })).toBeVisible();
    await admin.locator(".result-question summary").click();
    const adminDetail = admin.locator(".result-detail");
    await expectTable(adminDetail);
    await expectImage(adminDetail, STEM_ALT);
    await expectImage(adminDetail, RATIONALE_ALT);
    await admin.context().close();
  });
});
