import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { newAccount, signIn } from "./sign-in";

/** A one-question set in a new course of its own (and the Semester 1 it needs), imported through the API as from the Import screen. */
async function importCourse(page: Page): Promise<string> {
  const code = `T${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const source = JSON.stringify({
    title: "Week 1 exam set",
    desc: "Invented practice set.",
    terms: {},
    questions: [
      {
        id: "Q1",
        type: "single",
        topic: "W1 topic 1",
        cj: "Analyze cues",
        stem: "Invented stem for Week 1.",
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
  expect((await page.request.post("/api/semesters", { data: { number: 1 } })).status()).toBe(201);
  const imported = await page.request.post("/api/imports", {
    data: { source, folderName: "Week 1", newCourse: { code, title: `${code} exams`, semesterNumber: 1 } },
  });
  expect(imported.status()).toBe(201);
  return ((await imported.json()) as { courseId: string }).courseId;
}

test.describe("an exam whose time runs out while Exam setup is open", () => {
  test("counts down to 0, never 1, then is no longer in progress, and Start does not ask about it", async ({ page, browser }) => {
    // A user of its own, so no exam another test left running is the one in progress.
    const account = await newAccount(browser, "timeup");
    await page.clock.install();
    await signIn(page, account.email, account.password);
    const courseId = await importCourse(page);

    // The exam in progress is one this screen read 90 seconds before its end; the server knows of
    // none, as once it has recorded that exam as timed out. Later reads are the server's own.
    const setupPath = `**/api/courses/${courseId}/exams`;
    let reads = 0;
    await page.route(setupPath, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      reads += 1;
      const response = await route.fetch();
      const setup = (await response.json()) as Record<string, unknown>;
      if (reads > 1) return route.fulfill({ response, json: setup });
      const now = await page.evaluate(() => Date.now());
      const inProgress = {
        id: "0b6f5c1e-2d3a-4b5c-8d7e-9f0a1b2c3d4e",
        courseId,
        weeks: ["Week 1"],
        folderIds: null,
        courseExamId: null,
        pool: "all",
        practiceWeeks: null,
        questionCount: 1,
        timeLimitSeconds: 90,
        startedAt: new Date(now).toISOString(),
        endsAt: new Date(now + 90_000).toISOString(),
        status: "running",
        finishedAt: null,
        endReason: null,
        answeredCount: 0,
        fullyRight: null,
        points: null,
        maxPoints: null,
        minutesUsed: null,
      };
      return route.fulfill({ response, json: { ...setup, inProgress } });
    });

    await page.goto(`/course/${courseId}/exam`);
    const row = page.getByRole("button", { name: /^Exam in progress/ });
    await expect(row).toContainText("0 of 1 answered · 2 min left");
    await page.clock.fastForward("00:31");
    await expect(row).toContainText("0 of 1 answered · 1 min left");

    // Its time runs out: no time is left during the grace.
    await page.clock.fastForward("01:00");
    await expect(row).toContainText("0 of 1 answered · 0 min left");

    // The grace is over: it is not in progress any more, and the setup is read again.
    await page.clock.fastForward("00:31");
    await expect(row).toHaveCount(0);
    await expect.poll(() => reads).toBeGreaterThan(1);

    await page.getByRole("checkbox", { name: /^Week 1 / }).check();
    const started = page.waitForRequest((request) => request.url().endsWith(`/api/courses/${courseId}/exams`) && request.method() === "POST");
    await page.getByRole("button", { name: "Start exam" }).click();
    expect((await started).postDataJSON()).toEqual({ folderIds: [expect.any(String)], pool: "all", replaces: null });
    await expect(page.getByRole("dialog", { name: "Start a new exam?" })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/course/${courseId}/exam/[0-9a-f-]{36}$`));
    await expect(page.getByRole("button", { name: "End exam" })).toBeVisible();
  });
});
