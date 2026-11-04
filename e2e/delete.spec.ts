import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signIn } from "./sign-in";

// Delete and Undo: a set, a folder with its sets, and a past exam. Each delete warns in the
// server's words from its preview and deletes with the preview's confirm; Undo is offered right
// after, and Recently deleted brings things back for 30 days.

/** A set of single-answer questions; option 0 is right. */
function bank(title: string, size: number): string {
  return JSON.stringify({
    title,
    desc: "Invented practice set.",
    terms: {},
    questions: Array.from({ length: size }, (_, index) => ({
      id: `Q${String(index + 1)}`,
      type: "single",
      topic: `${title} topic ${String(index + 1)}`,
      stem: `Invented stem ${String(index + 1)} of ${title}.`,
      ask: "Which action comes first?",
      options: [
        { t: "The useful action", ok: true, why: "It addresses the finding." },
        { t: "A distractor", why: "It does not change the finding." },
        { t: "Another distractor", why: "It does not change the finding either." },
      ],
      rationale: "The useful action matches the finding.",
      takeaway: "Match the action to the finding.",
      terms: [],
    })),
  });
}

interface Course {
  id: string;
  code: string;
  folders: Record<string, string>;
  /** Question ids by set title. */
  questions: Record<string, string[]>;
}

/** Imports each [folder, set, size] into a new course, and reads back its folders and questions. */
async function importCourse(page: Page, plan: [string, string, number][]): Promise<Course> {
  const code = `D${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  let courseId: string | undefined;
  for (const [folderName, title, size] of plan) {
    const imported = await page.request.post("/api/imports", {
      data: {
        source: bank(title, size),
        folderName,
        ...(courseId === undefined ? { newCourse: { code, title: "Mental Health", semesterNumber: 1 } } : { courseId }),
      },
    });
    expect(imported.status()).toBe(201);
    courseId = ((await imported.json()) as { courseId: string }).courseId;
  }
  if (courseId === undefined) throw new Error("no sets imported");
  const response = await page.request.get(`/api/courses/${courseId}`);
  const detail = (await response.json()) as { folders: { id: string; name: string; sets: { title: string; questionIds: string[] }[] }[] };
  return {
    id: courseId,
    code,
    folders: Object.fromEntries(detail.folders.map((folder) => [folder.name, folder.id])),
    questions: Object.fromEntries(detail.folders.flatMap((folder) => folder.sets).map((set) => [set.title, set.questionIds])),
  };
}

function folderId(course: Course, name: string): string {
  const id = course.folders[name];
  if (id === undefined) throw new Error(`no folder ${name}`);
  return id;
}

async function answer(page: Page, questionId: string | undefined, choice: number): Promise<void> {
  const saved = await page.request.post("/api/attempts", {
    data: { clientAttemptId: crypto.randomUUID(), questionId, response: { type: "single", choice }, guessed: false },
  });
  expect(saved.status()).toBe(201);
}

async function startExam(page: Page, courseId: string, folderIds: string[]): Promise<string> {
  const started = await page.request.post(`/api/courses/${courseId}/exams`, { data: { folderIds, pool: "all" } });
  expect(started.status()).toBe(201);
  return ((await started.json()) as { id: string }).id;
}

async function finishExam(page: Page, examId: string): Promise<void> {
  const finished = await page.request.post(`/api/exams/${examId}/finish`, { data: { reason: "left" } });
  expect(finished.status()).toBe(200);
}

function sheet(page: Page, title: string) {
  return page.getByRole("dialog", { name: title });
}

/** The Undo offered at the bottom of the screen after a delete. */
function toast(page: Page) {
  return page.getByRole("status").filter({ has: page.getByRole("button", { name: "Dismiss" }) });
}

function sets(page: Page, folder: string) {
  return page.getByRole("list", { name: `Sets in ${folder}` }).getByRole("link");
}

test.describe("delete and undo", () => {
  test("she deletes a set from Select after its warning, and Undo brings it back; two sets go together", async ({ page }) => {
    await signIn(page);
    const course = await importCourse(page, [
      ["Week 4", "Anxiety A", 3],
      ["Week 4", "Anxiety B", 2],
    ]);
    // One wrong answer: it counts toward her progress and is in her Review list.
    await answer(page, course.questions["Anxiety A"]?.[0], 1);
    await page.goto(`/course/${course.id}/folder/${folderId(course, "Week 4")}`);
    await expect(sets(page, "Week 4")).toHaveText([/^Anxiety A/, /^Anxiety B/]);

    // Select, then Delete beside Move. Cancel changes nothing.
    await page.getByRole("button", { name: "Select sets" }).click();
    await page.getByRole("checkbox", { name: /^Anxiety A/ }).check();
    await page.getByRole("button", { name: "Delete 1 set" }).click();
    const warning = sheet(page, "Delete Anxiety A?");
    await expect(warning).toContainText(
      "Its 3 questions go with it. You have answered 1 of them: those answers stop counting toward your progress, and 1 question leaves your Review list. You can undo this for 30 days.",
    );
    await warning.getByRole("button", { name: "Cancel" }).click();
    await expect(warning).toBeHidden();
    await page.getByRole("button", { name: "Delete 1 set" }).click();
    await warning.getByRole("button", { name: "Delete" }).click();
    await expect(warning).toBeHidden();
    await expect(toast(page)).toContainText("Deleted “Anxiety A”.");
    await expect(sets(page, "Week 4")).toHaveText([/^Anxiety B/]);
    const course1 = (await (await page.request.get(`/api/courses/${course.id}`)).json()) as { reviewCount: number };
    expect(course1.reviewCount).toBe(0);

    // Undo, right away.
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect(toast(page)).toContainText("Brought back “Anxiety A”.");
    await expect(sets(page, "Week 4")).toHaveText([/^Anxiety A/, /^Anxiety B/]);

    // Both at once: each set's own warning, one Delete, and one Undo for both.
    await page.getByRole("button", { name: "Select sets" }).click();
    await page.getByRole("checkbox", { name: /^Anxiety A/ }).check();
    await page.getByRole("checkbox", { name: /^Anxiety B/ }).check();
    await page.getByRole("button", { name: "Delete 2 sets" }).click();
    const both = sheet(page, "Delete 2 sets?");
    await expect(both).toContainText("Delete Anxiety A? Its 3 questions go with it.");
    await expect(both).toContainText("Delete Anxiety B? Its 2 questions go with it. You can undo this for 30 days.");
    await both.getByRole("button", { name: "Delete" }).click();
    await expect(toast(page)).toContainText("Deleted 2 sets.");
    await expect(page.getByText("No sets yet. Move sets here, or tap Import here.")).toBeVisible();
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect(toast(page)).toContainText("Brought back 2 sets.");
    await expect(sets(page, "Week 4")).toHaveText([/^Anxiety A/, /^Anxiety B/]);
  });

  test("deleting a folder names the sets that go with it, and Recently deleted brings them back", async ({ page }) => {
    await signIn(page);
    const course = await importCourse(page, [
      ["Week 4", "Anxiety A", 3],
      ["Week 4", "Anxiety B", 2],
      ["Week 5", "Harder A", 2],
    ]);
    const made = await page.request.post(`/api/courses/${course.id}/course-exams`, {
      data: { name: "Exam 2", folderIds: [folderId(course, "Week 4"), folderId(course, "Week 5")] },
    });
    expect(made.status()).toBe(201);
    const examPageId = ((await made.json()) as { id: string }).id;

    // A folder with sets has Delete too, and its warning names every set that goes with it.
    await page.goto(`/course/${course.id}/folder/${folderId(course, "Week 4")}`);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const warning = sheet(page, "Delete Week 4?");
    await expect(warning).toContainText("Its 2 sets go with it: Anxiety A and Anxiety B, 5 questions in all. It comes off Exam 2. You can undo this for 30 days.");
    await warning.getByRole("button", { name: "Delete" }).click();

    // Back on its exam page, without it.
    await expect(page.getByRole("heading", { level: 1, name: "Exam 2" })).toBeVisible();
    await expect(toast(page)).toContainText("Deleted Week 4 and its 2 sets.");
    await expect(page.getByRole("list", { name: "Study material on Exam 2" }).getByRole("link")).toHaveText([/^Week 5/]);
    await toast(page).getByRole("button", { name: "Dismiss" }).click();
    await expect(toast(page)).toHaveCount(0);

    // The course lists what Undo can still bring back.
    await page.goto(`/course/${course.id}`);
    const recent = page.getByRole("link", { name: /^Recently deleted/ });
    await expect(recent).toContainText("1 item · Undo for 30 days");
    await recent.click();
    await expect(page.getByRole("heading", { level: 1, name: "Recently deleted" })).toBeVisible();
    const folders = page.getByRole("list", { name: "Deleted folders" });
    await expect(folders.getByRole("listitem")).toHaveCount(1);
    await expect(folders).toContainText("Week 4");
    await expect(folders).toContainText("Anxiety A, Anxiety B · Deleted today");
    await page.getByRole("button", { name: "Undo deleting Week 4" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Brought back" })).toHaveText("Brought back Week 4.");
    await expect(page.getByText("Nothing was deleted in the last 30 days.")).toBeVisible();

    // Back on Exam 2, with its sets.
    await page.goto(`/course/${course.id}/exam-page/${examPageId}`);
    await expect(page.getByRole("list", { name: "Study material on Exam 2" }).getByRole("link")).toHaveText([/^Week 4/, /^Week 5/]);
    await expect(page.getByRole("list", { name: "Study material on Exam 2" }).getByRole("link", { name: /^Week 4/ })).toContainText("2 sets · 5 questions");
  });

  test("she deletes a past exam from Exam setup, and Undo brings it back", async ({ page }) => {
    await signIn(page);
    const course = await importCourse(page, [["Week 4", "Anxiety A", 3]]);
    await finishExam(page, await startExam(page, course.id, [folderId(course, "Week 4")]));
    await page.goto(`/course/${course.id}/exam`);

    const past = page.getByRole("list", { name: "Past exams" });
    await expect(past.getByRole("listitem")).toHaveCount(1);
    await page.getByRole("button", { name: "Edit past exams" }).click();
    await past.getByRole("button", { name: "Delete the exam over Week 4 · today" }).click();
    const warning = sheet(page, "Delete this exam?");
    await expect(warning).toContainText("You can undo this for 30 days.");
    await warning.getByRole("button", { name: "Delete" }).click();
    await expect(toast(page)).toContainText("Deleted the exam.");
    await expect(page.getByText("Exams you finish show up here with their scores.")).toBeVisible();

    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect(toast(page)).toContainText("Brought back the exam.");
    await expect(past.getByRole("listitem")).toHaveCount(1);
    await expect(past.getByRole("button", { name: /^Week 4 · today/ })).toBeVisible();

    // Dismissed with a tap, the card goes; the next delete's card still closes by itself.
    await toast(page).getByRole("button", { name: "Dismiss" }).click();
    await expect(toast(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Edit past exams" }).click();
    await past.getByRole("button", { name: "Delete the exam over Week 4 · today" }).click();
    await warning.getByRole("button", { name: "Delete" }).click();
    await expect(toast(page)).toContainText("Deleted the exam.");
    await expect(toast(page)).toHaveCount(0, { timeout: 12_000 });
  });

  test("a set an exam in progress asks can't be deleted, and the warning says why", async ({ page }) => {
    await signIn(page);
    const course = await importCourse(page, [["Week 4", "Anxiety A", 3]]);
    const examId = await startExam(page, course.id, [folderId(course, "Week 4")]);
    try {
      await page.goto(`/course/${course.id}/folder/${folderId(course, "Week 4")}`);
      await page.getByRole("button", { name: "Select sets" }).click();
      await page.getByRole("checkbox", { name: /^Anxiety A/ }).check();
      await page.getByRole("button", { name: "Delete 1 set" }).click();
      const warning = sheet(page, "Delete Anxiety A?");
      await expect(warning.getByRole("alert")).toHaveText("An exam in progress asks questions from Anxiety A. Finish or leave that exam first.");
      await expect(warning.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await warning.getByRole("button", { name: "OK" }).click();
      await expect(warning).toBeHidden();
      await expect(page.getByRole("checkbox", { name: /^Anxiety A/ })).toBeChecked();
    } finally {
      await finishExam(page, examId);
    }
  });

  test("when what goes changed since the warning, she is warned again before anything is deleted", async ({ page }) => {
    await signIn(page);
    const course = await importCourse(page, [["Week 4", "Anxiety A", 3]]);
    await page.goto(`/course/${course.id}/folder/${folderId(course, "Week 4")}`);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const warning = sheet(page, "Delete Week 4?");
    await expect(warning).toContainText("Its set goes with it: Anxiety A, 3 questions in all.");

    // Another device files a set into Week 4 while the warning is open.
    const imported = await page.request.post("/api/imports", { data: { source: bank("Anxiety B", 2), folderId: folderId(course, "Week 4"), courseId: course.id } });
    expect(imported.status()).toBe(201);
    await warning.getByRole("button", { name: "Delete" }).click();
    await expect(warning.getByRole("alert")).toHaveText("Week 4 changed since you were warned. Look again before deleting it.");
    await expect(warning).toContainText("Its 2 sets go with it: Anxiety A and Anxiety B, 5 questions in all.");
    const still = (await (await page.request.get(`/api/courses/${course.id}`)).json()) as { folders: { name: string }[] };
    expect(still.folders.map((folder) => folder.name)).toContain("Week 4");

    await warning.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { level: 1, name: course.code })).toBeVisible();
    await expect(toast(page)).toContainText("Deleted Week 4 and its 2 sets.");
  });
});
