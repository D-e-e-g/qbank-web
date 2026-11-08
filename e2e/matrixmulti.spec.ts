import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ADMIN_EMAIL, ADMIN_PASSWORD, newAccount, signIn, STUDENT_EMAIL, type FakeAccount } from "./sign-in";

const LONG = "Longcolumnnamethatmustwrapinsteadofclipping";
const ROW_WHEEZE = "Wheeze after a long walk that keeps going when the sentence wraps on a phone and on a wide screen";
const ROW_NIGHT = "Wakes at night short of breath and needs more than one line when the row is narrow";
const TOPIC = "Wheeze findings";

function source(title: string): string {
  return JSON.stringify({
    title,
    desc: "Invented practice set.",
    terms: {},
    questions: [
      {
        id: "Q1",
        type: "matrixmulti",
        topic: TOPIC,
        stem: "An invented client has two findings. Nothing here is a real case.",
        ask: "For each finding, check every disorder it fits. A finding may fit more than one column.",
        columns: ["Asthma", "Heart failure", LONG],
        rows: [
          { t: ROW_WHEEZE, ans: ["Asthma"], why: "Wheeze points to asthma." },
          { t: ROW_NIGHT, ans: ["Asthma", "Heart failure"], why: "Both can wake a client short of breath." },
        ],
        rationale: "One finding fits asthma only. The other fits both.",
        takeaway: "A finding can fit more than one column.",
        terms: [],
      },
      {
        id: "Q2",
        type: "single",
        topic: "A later question",
        stem: "Invented stem for the question after the table.",
        ask: "Which action comes first?",
        options: [
          { t: "The useful action", ok: true, why: "It addresses the finding." },
          { t: "A distractor", why: "It does not change the finding." },
          { t: "Another distractor", why: "It does not change the finding either." },
        ],
        rationale: "The useful action matches the finding.",
        takeaway: "Match the action to the finding.",
        terms: [],
      },
    ],
  });
}

function courseCode(): string {
  return `M${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

interface Imported {
  courseId: string;
  folderId: string;
  setId: string;
}

async function importSet(page: Page, title: string): Promise<Imported> {
  const response = await page.request.post("/api/imports", {
    data: { source: source(title), folderName: "Week 1", newCourse: { code: courseCode(), title: "Invented matrix course", semesterNumber: 1 } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Imported;
}

async function openSet(page: Page, imported: Imported, title: string): Promise<void> {
  await page.goto(`/course/${imported.courseId}/folder/${imported.folderId}`);
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
}

async function checkColumn(page: Page, row: string, column: string): Promise<void> {
  await page.getByRole("group", { name: row, exact: true }).getByRole("checkbox", { name: column, exact: true }).click();
}

async function answerPartial(page: Page): Promise<void> {
  await checkColumn(page, ROW_WHEEZE, "Asthma");
  await checkColumn(page, ROW_WHEEZE, "Heart failure");
  await checkColumn(page, ROW_NIGHT, "Asthma");
}

async function overflows(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const scroller = document.querySelector(".runner-scroll");
    const pageWide = root.scrollWidth > root.clientWidth + 1;
    const runnerWide = scroller !== null && scroller.scrollWidth > scroller.clientWidth + 1;
    return pageWide || runnerWide;
  });
}

/** True when a visible element clips its own text. */
async function clipsText(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluateAll((els) =>
    els.some((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      // The wide grid hides each check's column name the same way .sr-only does, so that name is not a clip.
      if (style.position === "absolute" && el.clientWidth <= 1 && el.clientHeight <= 1) return false;
      return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    }),
  );
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${name}.png`), fullPage: true });
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

test.describe("matrix, check all that fit", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("answers, reveals, reviews, and shows the same grid on an exam result", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const wide = testInfo.project.name === "desktop-chrome";
    await signIn(page);
    const title = "Invented check-all table";
    const imported = await importSet(page, title);
    await openSet(page, imported, title);
    await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
    await expect(page.locator(".runner-format")).toHaveText("Matrix, check all that fit");
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check answer" })).toBeDisabled();

    await checkColumn(page, ROW_WHEEZE, "Asthma");
    await expect(page.getByRole("button", { name: "Check answer" })).toBeDisabled();
    await checkColumn(page, ROW_WHEEZE, "Heart failure");
    await checkColumn(page, ROW_NIGHT, "Asthma");
    await expect(page.getByRole("button", { name: "Check answer" })).toBeEnabled();
    expect(await overflows(page)).toBe(false);
    expect(await clipsText(page, ".matrix-multi .answer-card-label")).toBe(false);
    if (wide) {
      await expect(page.locator(".matrix-multi-head")).toBeVisible();
      expect(await clipsText(page, ".matrix-multi-col")).toBe(false);
      const boxes = await page.locator(".matrix-multi .matrix-choice").evaluateAll((els) =>
        els.map((el) => {
          const box = el.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        }),
      );
      expect(boxes).toHaveLength(6);
      for (const box of boxes) {
        expect(box.width).toBeCloseTo(44, 0);
        expect(box.height).toBeCloseTo(44, 0);
      }
      for (let column = 0; column < 3; column += 1) {
        const top = boxes[column];
        const bottom = boxes[column + 3];
        expect(top).toBeDefined();
        expect(bottom).toBeDefined();
        if (!top || !bottom) continue;
        expect(top.x).toBeCloseTo(bottom.x, 0);
      }
      for (let column = 1; column < 3; column += 1) {
        const first = boxes[0];
        const across = boxes[column];
        const second = boxes[3];
        const acrossSecond = boxes[column + 3];
        expect(first && across && second && acrossSecond).toBeTruthy();
        if (!first || !across || !second || !acrossSecond) continue;
        expect(first.y).toBeCloseTo(across.y, 0);
        expect(second.y).toBeCloseTo(acrossSecond.y, 0);
      }
    } else {
      await expect(page.locator(".matrix-multi-head")).toBeHidden();
      expect(await clipsText(page, ".matrix-choice-label")).toBe(false);
      await expect(page.locator(".matrix-multi-row")).toHaveCount(2);
    }
    await shot(page, testInfo, "answering");

    await page.getByRole("button", { name: "Close" }).click();
    await openSet(page, imported, title);
    await expect(page.getByRole("checkbox", { name: "Asthma", exact: true }).first()).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Check answer" })).toBeDisabled();

    await answerPartial(page);
    const sent = page.waitForRequest((request) => request.method() === "POST" && request.url().includes("/api/attempts"));
    await page.getByRole("button", { name: "Check answer" }).click();
    expect((await sent).postDataJSON()).toMatchObject({
      response: { type: "matrixmulti", choices: [["Asthma", "Heart failure"], ["Asthma"]] },
    });
    const status = page.getByRole("status");
    await expect(status).toContainText("Partly correct");
    await expect(status).toContainText("1 of 3 points");
    await expect(status).toContainText("+1 for each correct box, -1 for each wrong one");
    const wheeze = page.getByRole("group", { name: ROW_WHEEZE, exact: true });
    const night = page.getByRole("group", { name: ROW_NIGHT, exact: true });
    await expect(wheeze.getByRole("checkbox", { name: "Asthma" })).toHaveClass(/matrix-choice-correct/);
    await expect(wheeze.getByRole("checkbox", { name: "Heart failure" })).toHaveClass(/matrix-choice-wrong/);
    await expect(wheeze.getByRole("checkbox", { name: LONG })).toHaveClass(/matrix-choice-dim/);
    await expect(night.getByRole("checkbox", { name: "Asthma" })).toHaveClass(/matrix-choice-correct/);
    await expect(night.getByRole("checkbox", { name: "Heart failure" })).toHaveClass(/matrix-choice-missed/);
    await expect(night.getByRole("checkbox", { name: LONG })).toHaveClass(/matrix-choice-dim/);
    await expect(page.getByText("Wheeze points to asthma.")).toBeVisible();
    await expect(page.getByText("Both can wake a client short of breath.")).toBeVisible();
    expect(await overflows(page)).toBe(false);
    await shot(page, testInfo, "revealed");
    await night.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "revealed-lower");

    await page.getByRole("button", { name: "Next question" }).click();
    await expect(page.getByText("Invented stem for the question after the table.")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await openSet(page, imported, title);
    await expect(page.getByText("Picked up at 2 · 1 answered earlier")).toBeVisible();
    await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
    await expect(page.getByText("Invented stem for the question after the table.")).toBeVisible();

    await page.goto(`/course/${imported.courseId}/review`);
    await page.getByRole("button", { name: new RegExp(TOPIC) }).click();
    await expect(page).toHaveURL(/\/review\/practice\?question=/);
    await expect(page.locator(".runner-format")).toHaveText("Matrix, check all that fit");
    await expect(page.getByRole("checkbox", { name: "Asthma", exact: true }).first()).not.toBeChecked();
    await checkColumn(page, ROW_WHEEZE, "Asthma");
    await checkColumn(page, ROW_NIGHT, "Asthma");
    await checkColumn(page, ROW_NIGHT, "Heart failure");
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByRole("status")).toContainText("Correct");
    await expect(page.getByRole("status")).toContainText("3 of 3 points");
    await expect(page.getByRole("group", { name: ROW_NIGHT, exact: true }).getByRole("checkbox", { name: "Heart failure" })).toHaveClass(/matrix-choice-correct/);

    await page.goto(`/course/${imported.courseId}`);
    await page.getByRole("link", { name: /^Exam/ }).click();
    await page.getByRole("checkbox", { name: /^Week 1 / }).check();
    await page.getByRole("button", { name: "Start exam" }).click();
    for (let step = 0; step < 2; step += 1) {
      await expect(page.getByText(`${String(step + 1)} of 2`, { exact: true })).toBeVisible();
      const format = await page.locator(".runner-format").innerText();
      if (format === "Matrix, check all that fit") await answerPartial(page);
      else await page.getByRole("radio", { name: "The useful action", exact: true }).click();
      await page.getByRole("button", { name: step === 0 ? "Submit and continue" : "Finish exam" }).click();
    }
    await expect(page.getByRole("heading", { name: "1 of 2 fully right" })).toBeVisible();
    const result = page.locator(".result-question").filter({ hasText: "Matrix, check all that fit" });
    await expect(result).toContainText("1 of 3");
    await result.locator("summary").click();
    const missed = result.getByRole("group", { name: ROW_NIGHT, exact: true }).getByRole("checkbox", { name: "Heart failure" });
    await expect(result.getByRole("group", { name: ROW_WHEEZE, exact: true }).getByRole("checkbox", { name: "Heart failure" })).toHaveClass(/matrix-choice-wrong/);
    await expect(missed).toHaveClass(/matrix-choice-missed/);
    await missed.scrollIntoViewIfNeeded();
    expect(await overflows(page)).toBe(false);
    await shot(page, testInfo, "exam-result");
  });
});

test.describe("the frozen view of a check-all table", () => {
  let user: FakeAccount;

  test.beforeEach(async ({ browser, page }) => {
    user = await newAccount(browser, "matrix");
    await signIn(page, user.email, user.password);
  });

  test.afterEach(async ({ browser }) => {
    const context = await browser.newContext();
    const admin = await context.newPage();
    await signIn(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
    const list = (await (await admin.request.get("/api/admin/students")).json()) as { students: { id: string; email: string }[] };
    const student = list.students.find((item) => item.email === STUDENT_EMAIL);
    expect((await admin.request.put("/api/admin/students/viewing", { data: { studentId: student?.id } })).ok()).toBe(true);
    await context.close();
  });

  test("Check answer is refused, and the answer is not saved", async ({ browser, page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "admin on the wide layout");
    const imported = await importSet(page, "Frozen check-all table");
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
    await admin.goto("/admin");
    await admin.getByRole("list", { name: "User accounts" }).getByRole("button", { name: new RegExp(user.email) }).click();
    await expect(admin.getByText(`Viewing ${user.email}`)).toBeVisible();
    const writes: string[] = [];
    admin.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/api/")) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    await admin.goto(`/course/${imported.courseId}/practice/${imported.setId}?folder=${imported.folderId}`);
    await expect(admin.locator(".runner-format")).toHaveText("Matrix, check all that fit");
    await checkColumn(admin, ROW_WHEEZE, "Asthma");
    await checkColumn(admin, ROW_NIGHT, "Asthma");
    await checkColumn(admin, ROW_NIGHT, "Heart failure");
    await admin.getByRole("button", { name: "Check answer" }).click();
    const note = admin.getByRole("status").getByText(`This is a frozen view of ${user.email}. Nothing here can be changed.`);
    await expect(note).toBeVisible();
    await admin.getByRole("button", { name: "Dismiss" }).click();
    expect(writes).toEqual([]);
    const sitting = await page.request.get(`/api/practice-sets/${imported.setId}`);
    const body = (await sitting.json()) as { sitting: { answeredQuestionIds: string[] } | null };
    expect(body.sitting === null || body.sitting.answeredQuestionIds.length === 0).toBe(true);
    await adminContext.close();
  });
});
