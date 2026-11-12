import type { Browser, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ADMIN_EMAIL, ADMIN_PASSWORD, signIn } from "./sign-in";

const RIGHT = "The useful action";
const WRONG = "A distractor";

/** Single-answer questions whose topics name their folder's week, so the draw can be read off the screen. */
function bank(week: string, size: number): string {
  const tag = week.replace("Week ", "W");
  return JSON.stringify({
    title: `${week} exam set`,
    desc: "Invented practice set.",
    terms: {},
    questions: Array.from({ length: size }, (_, index) => ({
      id: `Q${String(index + 1)}`,
      type: "single",
      topic: `${tag} topic ${String(index + 1)}`,
      cj: index % 2 === 0 ? "Analyze cues" : "Take action",
      stem: `Invented stem for ${week}, question ${String(index + 1)}.`,
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

/** A folder's exam bank: exam twins of its practice questions, with topics that say so. */
function examBank(week: string, size: number): string {
  const tag = week.replace("Week ", "W");
  const practice = JSON.parse(bank(week, size)) as { questions: Record<string, unknown>[] };
  return JSON.stringify({
    title: `${week} exam bank`,
    desc: "Invented exam bank.",
    kind: "exam",
    terms: {},
    questions: practice.questions.map((question, index) => ({
      ...question,
      id: `E${String(index + 1)}`,
      twinOf: `Q${String(index + 1)}`,
      topic: `${tag} exam ${String(index + 1)}`,
    })),
  });
}

function courseCode(): string {
  return `X${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

/** A course with one set per folder, named for its week, imported through the API as she would from the Import screen. */
async function importCourse(page: Page, weeks: Record<string, number>): Promise<string> {
  const code = courseCode();
  let courseId: string | undefined;
  for (const [week, size] of Object.entries(weeks)) {
    const imported = await page.request.post("/api/imports", {
      data: {
        source: bank(week, size),
        folderName: week,
        ...(courseId === undefined ? { newCourse: { code, title: `${code} exams`, semesterNumber: 1 } } : { courseId }),
      },
    });
    expect(imported.status()).toBe(201);
    courseId = ((await imported.json()) as { courseId: string }).courseId;
  }
  if (courseId === undefined) throw new Error("no weeks given");
  return courseId;
}

async function tickFolder(page: Page, name: string): Promise<void> {
  await page.getByRole("checkbox", { name: new RegExp(`^${name} `) }).check();
}

/** The topic of the question on screen, which names its week. */
async function currentTopic(page: Page): Promise<string> {
  return (await page.locator(".runner-meta span").nth(1).textContent()) ?? "";
}

async function answerWith(page: Page, option: string, guessed = false): Promise<string> {
  const topic = await currentTopic(page);
  await page.getByRole("radio", { name: option, exact: true }).click();
  if (guessed) await page.getByRole("checkbox", { name: /I'm guessing/ }).check();
  return topic;
}

/** Rows whose topic is exactly this one, so "W1 topic 1" does not also match "W1 topic 10". */
function withTopic(rows: Locator, topic: string): Locator {
  return rows.filter({ has: rows.page().getByText(topic, { exact: true }) });
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

test.describe("exam", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("an exam over Weeks 1-3 draws only from them in proportion, times out, and sends only her misses and guesses to Review", async ({ page }) => {
    await page.clock.install();
    await signIn(page);
    const courseId = await importCourse(page, { "Week 1": 22, "Week 2": 27, "Week 3": 37, "Week 4": 10 });

    await page.goto(`/course/${courseId}`);
    await page.getByRole("link", { name: /^Exam/ }).click();
    await expect(page.getByRole("heading", { name: "Exam", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(4);
    await expect(page.getByText("Tick at least one folder.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start exam" })).toBeDisabled();

    await tickFolder(page, "Week 1");
    await tickFolder(page, "Week 2");
    await tickFolder(page, "Week 3");
    await expect(page.locator(".exam-summary-count")).toHaveText("40 questions");
    await expect(page.getByText("in 60 minutes")).toBeVisible();
    await expect(page.getByText("10 from Week 1 · 13 from Week 2 · 17 from Week 3")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /^Week 2 / })).toHaveAccessibleName("Week 2 27 questions 13 in exam");

    await page.getByRole("button", { name: "Start exam" }).click();
    await expect(page.getByText("1 of 40", { exact: true })).toBeVisible();
    await expect(page.getByRole("timer")).toHaveAccessibleName(/^(60:00|59:\d\d) left$/);
    // Feedback comes at the end: no Check answer, no marks while the exam runs.
    await expect(page.getByRole("button", { name: "Check answer" })).toHaveCount(0);

    const right = await answerWith(page, RIGHT);
    await page.getByRole("button", { name: "Submit and continue" }).click();
    await expect(page.getByText("2 of 40", { exact: true })).toBeVisible();
    await expect(page.locator(".feedback")).toHaveCount(0);
    const missed = await answerWith(page, WRONG);
    await page.getByRole("button", { name: "Submit and continue" }).click();
    await expect(page.getByText("3 of 40", { exact: true })).toBeVisible();
    const guessed = await answerWith(page, RIGHT, true);
    await page.getByRole("button", { name: "Submit and continue" }).click();
    await expect(page.getByText("4 of 40", { exact: true })).toBeVisible();
    const skipped = await currentTopic(page);
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByText("5 of 40", { exact: true })).toBeVisible();

    // Time runs out: the exam ends by itself.
    await page.clock.fastForward("01:00:00");
    await expect(page.getByRole("heading", { name: "2 of 40 fully right" })).toBeVisible();
    await expect(page.getByText(/2 of 40 points · \d+ min · Time ran out/)).toBeVisible();
    const stats = page.getByRole("list", { name: "Score summary" });
    await expect(stats.getByRole("listitem").filter({ hasText: "Missed" })).toContainText("1");
    await expect(stats.getByRole("listitem").filter({ hasText: "Guessed" })).toContainText("1");
    await expect(stats.getByRole("listitem").filter({ hasText: "Not answered" })).toContainText("37");

    const byFolder = page.getByRole("list", { name: "By folder" }).getByRole("listitem");
    await expect(byFolder).toHaveCount(3);
    await expect(byFolder.nth(0)).toHaveText(/^Week 1\d+ of 10$/);
    await expect(byFolder.nth(1)).toHaveText(/^Week 2\d+ of 13$/);
    await expect(byFolder.nth(2)).toHaveText(/^Week 3\d+ of 17$/);
    await expect(page.getByRole("list", { name: "By clinical judgment step" }).getByRole("listitem")).toHaveCount(2);
    const questions = page.locator(".result-question");
    await expect(questions).toHaveCount(40);
    await expect(questions.filter({ hasText: /W4 topic/ })).toHaveCount(0);
    await expect(questions.filter({ hasText: "Not answered" })).toHaveCount(37);
    await expect(withTopic(questions, skipped)).toContainText("Not answered");

    await withTopic(questions, missed).locator("summary").click();
    await expect(withTopic(questions, missed).getByText("The useful action matches the finding.")).toBeVisible();

    await page.getByRole("button", { name: "Open Review · 2 from this exam" }).click();
    await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^All 2$/ })).toBeVisible();
    const rows = page.locator(".review-list .review-row");
    await expect(rows).toHaveCount(2);
    await expect(withTopic(rows, missed)).toContainText("Missed");
    await expect(withTopic(rows, guessed)).toContainText("Guessed");
    await expect(withTopic(rows, right)).toHaveCount(0);
    await expect(withTopic(rows, skipped)).toHaveCount(0);
    await expect(rows.first()).toContainText("Exam");
  });

  test("skipped questions come back at the end, and Finish exam then ends it", async ({ page }) => {
    await signIn(page);
    const courseId = await importCourse(page, { "Week 1": 3, "Week 2": 2 });

    await page.goto(`/course/${courseId}/exam`);
    await tickFolder(page, "Week 1");
    await expect(page.locator(".exam-summary-count")).toHaveText("3 questions");
    await expect(page.getByText("in 4.5 minutes")).toBeVisible();
    await expect(page.getByText("3 from Week 1 · Fewer than 40, so it’s all of them at 1.5 minutes each.")).toBeVisible();
    await page.getByRole("button", { name: "Start exam" }).click();

    await expect(page.getByText("1 of 3", { exact: true })).toBeVisible();
    const skipped = await currentTopic(page);
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByText("2 of 3", { exact: true })).toBeVisible();
    await answerWith(page, RIGHT);
    await page.getByRole("button", { name: "Submit and continue" }).click();
    await expect(page.getByText("3 of 3", { exact: true })).toBeVisible();
    await answerWith(page, WRONG);
    await page.getByRole("button", { name: "Submit and continue" }).click();

    // Back to the first skipped question, told how many remain.
    await expect(page.getByText("1 of 3", { exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("1 skipped question left. This is the first one.");
    await expect(page.getByText("Skipped earlier")).toBeVisible();
    expect(await currentTopic(page)).toBe(skipped);
    await expect(page.getByRole("button", { name: "Finish exam" }).last()).toBeDisabled();

    await page.getByRole("status").getByRole("button", { name: "Finish exam" }).click();
    await expect(page.getByRole("heading", { name: "1 of 3 fully right" })).toBeVisible();
    await expect(page.getByText(/^1 of 3 points · 1 min$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Review · 1 from this exam" })).toBeVisible();

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("heading", { name: "Exam", exact: true })).toBeVisible();
    const past = page.getByRole("button", { name: /^Week 1 · today/ });
    await expect(past).toContainText("1 of 3");
  });

  test("a finish that does not land offers one Finish exam that retries, also after a reload, and records the exam as finished", async ({ page }) => {
    await signIn(page);
    const courseId = await importCourse(page, { "Week 1": 2 });
    await page.goto(`/course/${courseId}/exam`);
    await tickFolder(page, "Week 1");
    await page.getByRole("button", { name: "Start exam" }).click();
    await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
    const examId = new URL(page.url()).pathname.split("/").at(-1) ?? "";

    // The connection drops for the finish call only: both answers are in.
    const finish = `**/api/exams/${examId}/finish`;
    await page.route(finish, (route) => route.abort("internetdisconnected"));
    await answerWith(page, RIGHT);
    await page.getByRole("button", { name: "Submit and continue" }).click();
    await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
    await answerWith(page, RIGHT);
    await page.getByRole("button", { name: "Finish exam" }).click();

    // Not back on a submitted question with Submit and continue: one Finish exam, and why it has not ended.
    await expect(page.getByText("Every question is answered.")).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("No connection. The exam ends as soon as you are back online.");
    await expect(page.getByText("2 of 2 answered", { exact: true })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit and continue" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "End exam" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Finish exam" })).toHaveCount(1);

    // A reload opens it asking to finish, not on question 1.
    await page.reload();
    await expect(page.getByText("Every question is answered.")).toBeVisible();
    await expect(page.getByText("1 of 2", { exact: true })).toHaveCount(0);

    await page.unroute(finish);
    await page.getByRole("button", { name: "Finish exam" }).click();
    await expect(page.getByRole("heading", { name: "2 of 2 fully right" })).toBeVisible();
    await expect(page.getByText(/Time ran out|Ended early/)).toHaveCount(0);
    const ended = (await (await page.request.get(`/api/exams/${examId}`)).json()) as { endReason: string | null };
    expect(ended.endReason).toBe("finished");
  });

  test("wrong questions only draws what she last got wrong, and a folder's exam bank stands in for its practice questions", async ({ page }) => {
    await signIn(page);
    const courseId = await importCourse(page, { "Week 1": 4, "Week 2": 3 });
    const banked = await page.request.post("/api/imports", { data: { source: examBank("Week 2", 3), folderName: "Week 2", courseId } });
    expect(banked.status()).toBe(201);
    const bankSetId = ((await banked.json()) as { setId: string }).setId;

    // She misses two Week 1 questions in practice and gets a third right.
    const detail = (await (await page.request.get(`/api/courses/${courseId}`)).json()) as { folders: { name: string; sets: { questionIds: string[] }[] }[] };
    const week1 = detail.folders.find((folder) => folder.name === "Week 1")?.sets[0]?.questionIds ?? [];
    for (const [index, choice] of [1, 1, 0].entries()) {
      const saved = await page.request.post("/api/attempts", {
        data: { clientAttemptId: crypto.randomUUID(), questionId: week1[index], response: { type: "single", choice }, guessed: false },
      });
      expect(saved.status()).toBe(201);
    }

    await page.goto(`/course/${courseId}`);
    // The exam bank is one line under the folder's sets, not a set to practice.
    await expect(page.getByRole("link", { name: /^Week 2 1 set · 3 questions/ })).toBeVisible();
    await page.getByRole("link", { name: /^Week 2 / }).click();
    await expect(page.getByText("Exam twins: 3 questions, exams only")).toBeVisible();
    await expect(page.getByRole("list", { name: "Sets in Week 2" }).getByRole("listitem")).toHaveText([/^Week 2 exam set/]);
    await page.goto(`/course/${courseId}/practice/${bankSetId}`);
    await expect(page.getByText("This set’s questions are asked only on exams.")).toBeVisible();

    await page.goto(`/course/${courseId}/exam`);
    await expect(page.getByRole("checkbox", { name: /^Week 2 / })).toHaveAccessibleName("Week 2 3 questions · exam bank");
    await page.getByRole("switch", { name: /^Wrong questions only/ }).check();
    await expect(page.getByRole("checkbox", { name: /^Week 1 / })).toHaveAccessibleName("Week 1 2 wrong of 4");
    await expect(page.getByRole("checkbox", { name: /^Week 2 / })).toHaveAccessibleName("Week 2 0 wrong of 3 · exam bank");
    await expect(page.getByRole("checkbox", { name: /^Week 2 / })).toBeDisabled();
    await expect(page.getByText("Tick at least one folder with wrong questions.")).toBeVisible();
    await tickFolder(page, "Week 1");
    await expect(page.locator(".exam-summary-count")).toHaveText("2 questions");
    await expect(page.getByText("in 3 minutes")).toBeVisible();
    await expect(page.getByText("Week 1 has no exam bank yet, so it uses its practice questions.")).toBeVisible();
    await page.getByRole("button", { name: "Start exam" }).click();

    await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
    expect(["W1 topic 1", "W1 topic 2"]).toContain(await answerWith(page, RIGHT));
    await page.getByRole("button", { name: "Submit and continue" }).click();
    await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
    expect(["W1 topic 1", "W1 topic 2"]).toContain(await answerWith(page, WRONG));
    await page.getByRole("button", { name: "Finish exam" }).click();

    await expect(page.getByRole("heading", { name: "1 of 2 fully right" })).toBeVisible();
    await expect(page.locator(".runner-kicker")).toHaveText("Exam result · Week 1 · Wrong questions only");
    await expect(page.getByText("Week 1 had no exam bank, so its questions came from practice sets.")).toBeVisible();

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: /^Week 1 · today/ })).toContainText("Wrong questions only");
    // The one she answered fully right has left the pool.
    await page.getByRole("switch", { name: /^Wrong questions only/ }).check();
    await expect(page.getByRole("checkbox", { name: /^Week 1 / })).toHaveAccessibleName("Week 1 1 wrong of 4");
  });

  test("leaving asks first, ends the exam, and her history stays readable by the admin", async ({ page, browser }) => {
    await signIn(page);
    const courseId = await importCourse(page, { "Week 1": 4 });
    await page.goto(`/course/${courseId}/exam`);
    await tickFolder(page, "Week 1");
    await page.getByRole("button", { name: "Start exam" }).click();
    await expect(page.getByText("1 of 4", { exact: true })).toBeVisible();
    const missed = await answerWith(page, WRONG);
    await page.getByRole("button", { name: "Submit and continue" }).click();
    await expect(page.getByText("2 of 4", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "End exam" }).click();
    const sheet = page.getByRole("dialog", { name: "End the exam now?" });
    await expect(sheet).toContainText("The 1 question you answered will be scored.");
    await sheet.getByRole("button", { name: "Keep going" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("2 of 4", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "End exam" }).click();
    await page.getByRole("dialog", { name: "End the exam now?" }).getByRole("button", { name: "End exam" }).click();
    await expect(page.getByRole("heading", { name: "0 of 4 fully right" })).toBeVisible();
    await expect(page.getByText(/Ended early/)).toBeVisible();
    await expect(page.locator(".result-question").filter({ hasText: "Not answered" })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Open Review · 1 from this exam" })).toBeVisible();

    const review = await page.request.get(`/api/courses/${courseId}/review`);
    const list = (await review.json()) as { counts: { all: number }; questions: { topic: string }[] };
    expect(list.counts.all).toBe(1);
    expect(list.questions[0]?.topic).toBe(missed);

    const admin = await signedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    await admin.goto(`/course/${courseId}`);
    await admin.getByRole("link", { name: /^Exam/ }).click();
    await expect(admin.getByText("Viewing student@example.com")).toBeVisible();
    await expect(admin.getByRole("button", { name: "Start exam" })).toBeVisible();
    await admin.getByRole("button", { name: /^Week 1 · today/ }).click();
    await expect(admin.getByRole("heading", { name: "0 of 4 fully right" })).toBeVisible();
    await expect(admin.getByRole("button", { name: /Open Review · 1 from this exam/ })).toBeVisible();
    await admin.context().close();
  });
});
