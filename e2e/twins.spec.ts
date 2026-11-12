import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signIn } from "./sign-in";

// Exam twins from Exam setup. The test API has no Claude key, so Make questions is off there, as it
// is for every account but hers. These tests stand in for the twin-job routes with page.route and
// keep the rest real: the course, its folders and wrong answers, and the exam started on the twins.

const RIGHT = "The useful action";
const WRONG = "A distractor";
const JOB_ID = "6a1f0b8e-2c4d-4e6f-8a0b-1c2d3e4f5a6b";

interface Course {
  id: string;
  code: string;
  folders: Record<string, string>;
}

function bank(title: string, size: number): string {
  return JSON.stringify({
    title,
    desc: "Invented practice set.",
    terms: {},
    questions: Array.from({ length: size }, (_, index) => ({
      id: `A${String(index + 1).padStart(2, "0")}`,
      type: "single",
      topic: `${title} topic ${String(index + 1)}`,
      cj: "Take action",
      stem: `Invented stem ${String(index + 1)} of ${title}.`,
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

/** Her course shape: Exam 2 over Weeks 4 and 5, with two wrong answers in Week 5. */
async function importCourse(page: Page): Promise<Course> {
  const code = `X${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  let courseId: string | undefined;
  for (const [week, title] of [
    ["Week 4", "Anxiety disorders"],
    ["Week 5", "Harder A"],
  ]) {
    const imported = await page.request.post("/api/imports", {
      data: {
        source: bank(title ?? "", 4),
        folderName: week,
        ...(courseId === undefined ? { newCourse: { code, title: "Mental Health", semesterNumber: 1 } } : { courseId }),
      },
    });
    expect(imported.status()).toBe(201);
    courseId = ((await imported.json()) as { courseId: string }).courseId;
  }
  if (courseId === undefined) throw new Error("no course");
  const detail = (await (await page.request.get(`/api/courses/${courseId}`)).json()) as {
    folders: { id: string; name: string; sets: { questionIds: string[] }[] }[];
  };
  const folders = Object.fromEntries(detail.folders.map((folder) => [folder.name, folder.id]));
  const page2 = await page.request.post(`/api/courses/${courseId}/course-exams`, { data: { name: "Exam 2", folderIds: [folders["Week 4"], folders["Week 5"]] } });
  expect(page2.status()).toBe(201);
  const week5 = detail.folders.find((folder) => folder.name === "Week 5")?.sets[0]?.questionIds ?? [];
  for (const [index, choice] of [1, 1, 0].entries()) {
    const saved = await page.request.post("/api/attempts", {
      data: { clientAttemptId: crypto.randomUUID(), questionId: week5[index], response: { type: "single", choice }, guessed: false },
    });
    expect(saved.status()).toBe(201);
  }
  return { id: courseId, code, folders };
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

/** GET /api/question-maker as it answers her account: she may make questions now. */
async function makeQuestionsOn(page: Page): Promise<void> {
  await page.route("**/api/question-maker", (route) =>
    route.fulfill({
      json: {
        available: true,
        reason: null,
        dailyLimit: 5,
        startedToday: 0,
        nextAvailableAt: null,
        levels: [],
        defaultLevel: "exam",
        sampleSize: 5,
        limits: { photos: 10, photoBytes: 5_000_000, fileBytes: 20_000_000, textCharacters: 200_000 },
        imageTypes: [],
        fileTypes: [],
      },
    }),
  );
}

type Status = "running" | "done" | "failed" | "cancelled";

/** A twin job of Week 5's wrong questions, at the given point. */
function twinJob(course: Course, status: Status, at: "read" | "twins" | "file" | "done", failure: string | null = null) {
  const order = ["read", "twins", "file"] as const;
  const reached = at === "done" ? 3 : order.indexOf(at);
  const stopped = status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "current";
  const labels = { read: "Read your questions", twins: "Exam twins", file: "File the twins" };
  const week5 = course.folders["Week 5"] ?? "";
  return {
    id: JOB_ID,
    status,
    step: at,
    steps: order.map((key, index) => ({
      key,
      label: labels[key],
      state: index < reached ? "done" : index === reached ? stopped : "todo",
      done: index === reached && key === "twins" ? 1 : null,
      total: index === reached && key === "twins" ? 2 : null,
    })),
    course: { id: course.id, code: course.code, title: "Mental Health" },
    level: "exam",
    pool: "wrong",
    folders: [{ id: week5, name: "Week 5", questionCount: 2, twinCount: 2, alreadyTwinned: 0 }],
    twinCount: 2,
    note: "QBank writes exam twins of 2 wrong questions in Week 5.",
    sets:
      status === "done"
        ? [{ setId: crypto.randomUUID(), title: "Harder A exam", folderId: week5, folderName: "Week 5", examPageId: null, questionCount: 2, termCount: 0, twinsOf: { id: crypto.randomUUID(), title: "Harder A" } }]
        : [],
    // The real exam over Week 5: the test API has no twins, so it asks her practice questions.
    exam: status === "done" ? { folderIds: [week5], pool: "all" } : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: status === "running" ? null : new Date().toISOString(),
    failure,
    warnings: [] as string[],
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

/** Stands in for the twin-job routes, answering each read of the job with the next state in `reads`. */
async function twinRoutes(page: Page, course: Course, reads: ReturnType<typeof twinJob>[]): Promise<{ started: unknown[]; cancelled: number }> {
  const seen = { started: [] as unknown[], cancelled: 0 };
  let read = 0;
  let current = reads[0];
  await page.route(/\/api\/twin-jobs(\/.*)?$/, async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/twin-jobs" && request.method() === "POST") {
      seen.started.push(request.postDataJSON());
      await route.fulfill({ status: 202, json: current });
      return;
    }
    if (path === "/api/twin-jobs") {
      await route.fulfill({ json: { jobs: read === 0 ? [] : [current] } });
      return;
    }
    if (path === `/api/twin-jobs/${JOB_ID}/cancel`) {
      seen.cancelled += 1;
      current = twinJob(course, "cancelled", "twins", "The set was cancelled.");
      await route.fulfill({ json: current });
      return;
    }
    if (seen.cancelled === 0) current = reads[Math.min(read, reads.length - 1)];
    read += 1;
    await route.fulfill({ json: current });
  });
  return seen;
}

async function openSetup(page: Page, course: Course): Promise<void> {
  await page.goto(`/course/${course.id}/exam`);
  await page.getByRole("checkbox", { name: /^Week 5 / }).check();
  await page.getByRole("switch", { name: /Wrong questions only/ }).check();
  await expect(page.locator(".exam-summary-count")).toHaveText("2 questions");
}

test.describe("exam twins", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await archiveCourses(page);
  });

  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("Exam setup has no Twin option on an account that may not make questions", async ({ page }) => {
    const course = await importCourse(page);
    await openSetup(page, course);
    await expect(page.getByRole("button", { name: "Start exam" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Write exam twins" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Exam twins" })).toHaveCount(0);
  });

  test("Twin writes exam twins of Week 5's wrong questions, shows each step, and starts the exam on them", async ({ page }) => {
    const course = await importCourse(page);
    await makeQuestionsOn(page);
    const seen = await twinRoutes(page, course, [
      twinJob(course, "running", "read"),
      twinJob(course, "running", "twins"),
      twinJob(course, "running", "file"),
      twinJob(course, "done", "done"),
    ]);
    await openSetup(page, course);
    await expect(page.getByText("Or QBank writes a new exam twin of each wrong question in the folders you tick")).toBeVisible();
    await page.getByRole("button", { name: "Write exam twins" }).click();

    // The same course, folders, and pool as the exam.
    await expect(page).toHaveURL(`/course/${course.id}/twins/${JOB_ID}`);
    expect(seen.started).toEqual([{ courseId: course.id, folderIds: [course.folders["Week 5"]], pool: "wrong" }]);
    await expect(page.getByRole("heading", { name: "Exam twins", level: 1 })).toBeVisible();
    await expect(page.getByText("QBank writes exam twins of 2 wrong questions in Week 5.")).toBeVisible();
    const steps = page.getByRole("list", { name: "Steps" }).getByRole("listitem");
    await expect(steps).toHaveText(["Read your questionsWorking", "Exam twins", "File the twins"]);
    await expect(steps).toHaveText(["Read your questionsDone", "Exam twins1 of 2", "File the twins"]);
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

    // Done: the filed set, and the exam on the twins.
    await expect(steps).toHaveText(["Read your questionsDone", "Exam twinsDone", "File the twinsDone"]);
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Filed" })).toContainText("Harder A exam");
    await expect(page.getByRole("list", { name: "Filed" })).toContainText("Week 5 · 2 questions · Twins of Harder A");

    // Found again from Exam setup after she leaves.
    await page.getByRole("link", { name: "Exam", exact: true }).click();
    const twins = page.getByRole("list", { name: "Exam twins" });
    await expect(twins).toContainText("Week 5 · today");
    await expect(twins).toContainText("2 exam twins · Wrong questions only");
    await expect(twins).toContainText("Ready");
    await twins.getByRole("button").click();
    await expect(page).toHaveURL(`/course/${course.id}/twins/${JOB_ID}`);

    const started = page.waitForRequest((request) => request.url().endsWith(`/api/courses/${course.id}/exams`) && request.method() === "POST");
    await page.getByRole("button", { name: "Start exam on the twins" }).click();
    // No exam was running, and the request says so.
    expect((await started).postDataJSON()).toEqual({ folderIds: [course.folders["Week 5"]], pool: "all", replaces: null });
    await expect(page).toHaveURL(new RegExp(`/course/${course.id}/exam/[0-9a-f-]{36}$`));
    await expect(page.getByRole("button", { name: "End exam" })).toBeVisible();
  });

  test("Start on the twins waits until it is known whether an exam is running, then asks before ending it", async ({ page }) => {
    const course = await importCourse(page);
    await twinRoutes(page, course, [twinJob(course, "done", "done")]);
    const running = await page.request.post(`/api/courses/${course.id}/exams`, { data: { folderIds: [course.folders["Week 5"]], pool: "all" } });
    expect(running.status()).toBe(201);
    const runningId = ((await running.json()) as { id: string }).id;

    // The read of the running exam fails: Start stays off instead of ending it unasked.
    const setupPath = `**/api/courses/${course.id}/exams`;
    await page.route(setupPath, (route) => (route.request().method() === "GET" ? route.abort("internetdisconnected") : route.fallback()));
    await page.goto(`/course/${course.id}/twins/${JOB_ID}`);
    const start = page.getByRole("button", { name: "Start exam on the twins" });
    await expect(page.getByText("Could not check for an exam in progress. Trying again.")).toBeVisible();
    await expect(start).toBeDisabled();

    // Back online: it is read again, and Start asks first.
    await page.unroute(setupPath);
    await expect(start).toBeEnabled();
    await expect(page.getByText("Could not check for an exam in progress. Trying again.")).toHaveCount(0);
    await start.click();
    const sheet = page.getByRole("dialog", { name: "Start a new exam?" });
    await expect(sheet).toContainText("The exam in progress ends now.");
    const started = page.waitForRequest((request) => request.url().endsWith(`/api/courses/${course.id}/exams`) && request.method() === "POST");
    await sheet.getByRole("button", { name: "Start new exam" }).click();
    expect((await started).postDataJSON()).toEqual({ folderIds: [course.folders["Week 5"]], pool: "all", replaces: runningId });
    await expect(page).toHaveURL(new RegExp(`/course/${course.id}/exam/[0-9a-f-]{36}$`));
    await expect(page.getByRole("button", { name: "End exam" })).toBeVisible();
  });

  test("a refusal shows its sentence on Exam setup, and a stopped or failed job says so", async ({ page }) => {
    const course = await importCourse(page);
    await makeQuestionsOn(page);
    const refusal = "Every wrong question in Week 5 already has an exam twin. Start the exam with Wrong questions only to take them.";
    await page.route("**/api/twin-jobs", (route) =>
      route.request().method() === "POST" ? route.fulfill({ status: 400, json: { error: "invalid_request", message: refusal } }) : route.fulfill({ json: { jobs: [] } }),
    );
    await openSetup(page, course);
    await page.getByRole("button", { name: "Write exam twins" }).click();
    await expect(page.getByText(refusal)).toBeVisible();
    await expect(page).toHaveURL(`/course/${course.id}/exam`);
    // The sentence was about these folders and this pool; changing them clears it.
    await page.getByRole("switch", { name: /Wrong questions only/ }).uncheck();
    await expect(page.getByText(refusal)).toHaveCount(0);
    await page.unroute("**/api/twin-jobs");

    // Stop asks first, then the job ends cancelled.
    const seen = await twinRoutes(page, course, [twinJob(course, "running", "twins")]);
    await page.goto(`/course/${course.id}/twins/${JOB_ID}`);
    await page.getByRole("button", { name: "Stop" }).click();
    await page.getByRole("button", { name: "Keep going" }).click();
    expect(seen.cancelled).toBe(0);
    await page.getByRole("button", { name: "Stop" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Stop" }).click();
    await expect(page.getByText("The set was cancelled.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Steps" }).getByRole("listitem")).toHaveText(["Read your questionsDone", "Exam twinsCancelled", "File the twins"]);
    expect(seen.cancelled).toBe(1);
    await page.unroute(/\/api\/twin-jobs(\/.*)?$/);

    // A failed job shows its reason as it is.
    const reason = "Claude could not be reached. Try again in a little while.";
    await twinRoutes(page, course, [twinJob(course, "failed", "twins", reason)]);
    await page.reload();
    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByRole("list", { name: "Steps" }).getByRole("listitem")).toHaveText(["Read your questionsDone", "Exam twinsFailed", "File the twins"]);
    await expect(page.getByRole("button", { name: "Start exam on the twins" })).toHaveCount(0);
    await page.unroute(/\/api\/twin-jobs(\/.*)?$/);

    // Done with every twin left out at filing: nothing filed, and the warning says why.
    const leftOut = "Harder A: 2 questions had an exam twin in Week 5 by the time QBank filed these, so QBank left their new twins out.";
    await twinRoutes(page, course, [{ ...twinJob(course, "done", "done"), sets: [], warnings: [leftOut] }]);
    await page.reload();
    await expect(page.getByText("Nothing was filed.")).toBeVisible();
    await expect(page.getByText(leftOut)).toBeVisible();
    await expect(page.getByRole("list", { name: "Filed" })).toHaveCount(0);
  });
});
