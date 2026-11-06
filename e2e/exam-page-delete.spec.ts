import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ADMIN_EMAIL, ADMIN_PASSWORD, signIn } from "./sign-in";

// Deleting a page, in a course or a topic, from More at its title: the server's warning says its
// folders stay, the delete sends the warning's confirm, and Undo is offered right away and in the
// course's Recently deleted for 30 days. The page goes alone: its folders stay in the course, at
// the end of its Folders list, with their sets, her answers and her past exams, and Undo puts them
// back on it. The server's refusals show in its words.

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

type Place = { newCourse: { code: string; title: string; semesterNumber: number } } | { newTopic: { title: string } };

/** Imports each [folder, set, size] into a new course or topic, and reads back its folders and questions. */
async function importInto(page: Page, place: Place, plan: [string, string, number][]): Promise<Course> {
  let courseId: string | undefined;
  for (const [folderName, title, size] of plan) {
    const imported = await page.request.post("/api/imports", { data: { source: bank(title, size), folderName, ...(courseId === undefined ? place : { courseId }) } });
    expect(imported.status()).toBe(201);
    courseId = ((await imported.json()) as { courseId: string }).courseId;
  }
  if (courseId === undefined) throw new Error("no sets imported");
  const response = await page.request.get(`/api/courses/${courseId}`);
  const detail = (await response.json()) as { code: string; title: string; folders: { id: string; name: string; sets: { title: string; questionIds: string[] }[] }[] };
  return {
    id: courseId,
    code: detail.code,
    folders: Object.fromEntries(detail.folders.map((folder) => [folder.name, folder.id])),
    questions: Object.fromEntries(detail.folders.flatMap((folder) => folder.sets).map((set) => [set.title, set.questionIds])),
  };
}

function newCourse(): Place {
  return { newCourse: { code: `P${Math.random().toString(36).slice(2, 8)}`.toUpperCase(), title: "Mental Health", semesterNumber: 1 } };
}

function folderId(course: Course, name: string): string {
  const id = course.folders[name];
  if (id === undefined) throw new Error(`no folder ${name}`);
  return id;
}

async function addExamPage(page: Page, courseId: string, name: string, folderIds: string[]): Promise<string> {
  const made = await page.request.post(`/api/courses/${courseId}/course-exams`, { data: { name, folderIds } });
  expect(made.status()).toBe(201);
  return ((await made.json()) as { id: string }).id;
}

async function answer(page: Page, questionId: string | undefined, choice: number): Promise<void> {
  const saved = await page.request.post("/api/attempts", {
    data: { clientAttemptId: crypto.randomUUID(), questionId, response: { type: "single", choice }, guessed: false },
  });
  expect(saved.status()).toBe(201);
}

async function takeExam(page: Page, courseId: string, folderIds: string[]): Promise<void> {
  const started = await page.request.post(`/api/courses/${courseId}/exams`, { data: { folderIds, pool: "all" } });
  expect(started.status()).toBe(201);
  const examId = ((await started.json()) as { id: string }).id;
  expect((await page.request.post(`/api/exams/${examId}/finish`, { data: { reason: "left" } })).status()).toBe(200);
}

function sheet(page: Page, title: string) {
  return page.getByRole("dialog", { name: title });
}

/** The Undo offered at the bottom of the screen after a delete. */
/** Recently deleted, in More at the title of a course or topic. */
async function openRecentlyDeleted(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Recently deleted" }).click();
}

function toast(page: Page) {
  return page.getByRole("status").filter({ has: page.getByRole("button", { name: "Dismiss" }) });
}

function links(page: Page, list: string) {
  return page.getByRole("list", { name: list, exact: true }).getByRole("link");
}

/** On the page's screen: More, then its last row. */
async function deletePage(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Delete page" }).click();
}

test.describe("deleting a page", () => {
  test.afterEach(async ({ page }) => {
    await archiveEverything(page);
  });

  test("she deletes a page after its warning: its folders stay with their sets and her past exam, and Undo puts them back on it", async ({ page }) => {
    await signIn(page);
    const course = await importInto(page, newCourse(), [
      ["Week 3", "Psychosis", 3],
      ["Week 3", "Antipsychotics", 2],
      ["Week 4", "Substance use", 3],
      ["Week 5", "Personality", 2],
    ]);
    const onPage = [folderId(course, "Week 3"), folderId(course, "Week 4")];
    const examPageId = await addExamPage(page, course.id, "Exam 2", onPage);
    await answer(page, course.questions.Psychosis?.[0], 0);
    await takeExam(page, course.id, onPage);
    const warningText = "Its 2 folders stay, with their sets and your progress, under Folders: Week 3 and Week 4. Your 1 past exam over it stays. You can undo this for 30 days.";

    // More ends with Delete page, red, after a line; the editor has no Delete.
    await page.goto(`/course/${course.id}/exam-page/${examPageId}`);
    await page.getByRole("button", { name: /^More for / }).click();
    const more = page.getByRole("menu");
    await expect(more.getByRole("menuitem")).toHaveText(["Edit page", "Delete page"]);
    await expect(more.locator("[role=separator] + [role=menuitem]")).toHaveText("Delete page");
    await expect(more.getByRole("menuitem").last()).toHaveClass(/menu-row-destructive/);
    await more.getByRole("menuitem", { name: "Edit page" }).click();
    const editor = sheet(page, "Edit page");
    await expect(editor.getByText("Page name", { exact: true })).toBeVisible();
    await expect(editor.getByRole("button", { name: /Delete/ })).toHaveCount(0);
    await editor.getByRole("button", { name: "Cancel" }).click();

    // The warning names the folders that stay. Cancel changes nothing.
    await deletePage(page);
    const warning = sheet(page, "Delete Exam 2?");
    await expect(warning).toContainText(warningText);
    await warning.getByRole("button", { name: "Cancel" }).click();
    await expect(warning).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Exam 2" })).toBeVisible();

    // Delete: back on the course, without the page, and its folders last in the Folders list.
    await deletePage(page);
    await warning.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: course.code })).toBeVisible();
    await expect(toast(page)).toContainText("Deleted Exam 2.");
    await expect(page.getByText("No pages yet. Tap + to make Page 1.")).toBeVisible();
    await expect(links(page, "Folders")).toHaveText([/^Week 5/, /^Week 3/, /^Week 4/]);
    await expect(links(page, "Folders").filter({ hasText: /^Week 3/ })).toContainText("2 sets · 1 of 5 answered");

    // Undo, right away: the page is back with its folders on it.
    await toast(page).getByRole("button", { name: "Undo", exact: true }).click();
    await expect(toast(page)).toContainText("Brought back Exam 2.");
    await expect(links(page, "Pages")).toHaveText([/^Exam 2/]);
    await expect(links(page, "Pages")).toContainText("2 folders · 8 questions");
    await expect(links(page, "Folders")).toHaveText([/^Week 5/]);
    await toast(page).getByRole("button", { name: "Dismiss" }).click();

    // Deleted again, its folder opens from the Folders list with its sets, on no page.
    await links(page, "Pages").filter({ hasText: /^Exam 2/ }).click();
    await deletePage(page);
    await warning.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(toast(page)).toContainText("Deleted Exam 2.");
    await toast(page).getByRole("button", { name: "Dismiss" }).click();
    await links(page, "Folders").filter({ hasText: /^Week 3/ }).click();
    await expect(page.getByText("On no page · 2 sets · 1 of 5 answered")).toBeVisible();
    await expect(page.getByRole("list", { name: "Sets in Week 3" }).getByRole("link")).toHaveText([/^Antipsychotics/, /^Psychosis/]);

    // Her past exam over it stays in Exam setup.
    await page.goto(`/course/${course.id}/exam`);
    await expect(page.getByRole("list", { name: "Past exams" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("list", { name: "Past exams" }).getByRole("button", { name: /^Week 3, Week 4 · today/ })).toBeVisible();

    // Recently deleted lists it with the folders Undo puts back on it.
    await page.goto(`/course/${course.id}`);
    await expect(page.getByRole("link", { name: /^Recently deleted/ })).toHaveCount(0);
    await openRecentlyDeleted(page);
    await expect(page.getByRole("heading", { level: 1, name: "Recently deleted" })).toBeVisible();
    const pages = page.getByRole("list", { name: "Deleted pages" });
    await expect(pages.getByRole("listitem")).toHaveCount(1);
    await expect(pages).toContainText("Exam 2");
    await expect(pages).toContainText("Week 3, Week 4 · Deleted today");
    await page.getByRole("button", { name: "Undo deleting Exam 2" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Brought back" })).toHaveText("Brought back Exam 2.");
    await expect(page.getByText("Nothing was deleted in the last 30 days.")).toBeVisible();

    // Back on Exam 2: its folders in their order, and her past exam on it again.
    await page.goto(`/course/${course.id}/exam-page/${examPageId}`);
    await expect(links(page, "Study material on Exam 2")).toHaveText([/^Week 3/, /^Week 4/]);
    await expect(page.getByRole("list", { name: "Past exams" }).getByRole("listitem")).toHaveCount(1);
  });

  test("the server's refusals show in its words: a folder name already under Folders, a change since the warning, and a page name taken before Undo", async ({ page }) => {
    await signIn(page);
    const course = await importInto(page, newCourse(), [
      ["Week 3", "Psychosis", 3],
      ["Week 4", "Substance use", 2],
      ["Week 5", "Personality", 2],
    ]);
    const examPageId = await addExamPage(page, course.id, "Exam 2", [folderId(course, "Week 3"), folderId(course, "Week 4")]);

    // A folder of the same name under Folders: the page can't go until one is renamed. OK changes nothing.
    const made = await page.request.post(`/api/courses/${course.id}/folders`, { data: { name: "Week 3" } });
    expect(made.status()).toBe(201);
    const looseId = ((await made.json()) as { id: string }).id;
    await page.goto(`/course/${course.id}/exam-page/${examPageId}`);
    await deletePage(page);
    const warning = sheet(page, "Delete Exam 2?");
    await expect(warning.getByRole("alert")).toHaveText(`${course.code} already has a folder named Week 3 in its Folders list. Rename one of them before deleting Exam 2.`);
    await expect(warning.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await warning.getByRole("button", { name: "OK" }).click();
    await expect(warning).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Exam 2" })).toBeVisible();

    // Renamed, it can go; but another device puts Week 5 on the page while the warning is open.
    expect((await page.request.patch(`/api/folders/${looseId}`, { data: { name: "Week 3 recap" } })).status()).toBe(200);
    await deletePage(page);
    await expect(warning).toContainText("Its 2 folders stay, with their sets and your progress, under Folders: Week 3 and Week 4. You can undo this for 30 days.");
    expect((await page.request.patch(`/api/folders/${folderId(course, "Week 5")}`, { data: { examPageId } })).status()).toBe(200);
    await warning.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(warning.getByRole("alert")).toHaveText("Exam 2 changed since you were warned. Look again before deleting it.");
    await expect(warning).toContainText("Its 3 folders stay, with their sets and your progress, under Folders: Week 3, Week 4 and Week 5.");
    const still = (await (await page.request.get(`/api/courses/${course.id}`)).json()) as { exams: { name: string }[] };
    expect(still.exams.map((exam) => exam.name)).toEqual(["Exam 2"]);
    await warning.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: course.code })).toBeVisible();
    await expect(toast(page)).toContainText("Deleted Exam 2.");

    // A new Exam 2 takes its name: Undo says why it can't, and is off in Recently deleted.
    await addExamPage(page, course.id, "Exam 2", []);
    const taken = "This course already has a page named Exam 2. Rename one of them, then bring this one back.";
    await toast(page).getByRole("button", { name: "Undo", exact: true }).click();
    await expect(toast(page)).toContainText(taken);
    await page.goto(`/course/${course.id}/deleted`);
    const row = page.getByRole("list", { name: "Deleted pages" }).getByRole("listitem");
    await expect(row).toContainText("Week 3, Week 4, Week 5 · Deleted today");
    await expect(row).toContainText(taken);
    await expect(row.getByRole("button", { name: "Undo deleting Exam 2" })).toBeDisabled();
  });

  test("a topic's page is deleted the same way", async ({ page }) => {
    await signIn(page);
    const topic = await importInto(page, { newTopic: { title: `Topic ${Math.random().toString(36).slice(2, 8)}` } }, [["Unit 1", "Unit 1 - Set 1", 2]]);
    const pageId = await addExamPage(page, topic.id, "Page 1", [folderId(topic, "Unit 1")]);

    await page.goto(`/course/${topic.id}/exam-page/${pageId}`);
    await deletePage(page);
    const warning = sheet(page, "Delete Page 1?");
    await expect(warning).toContainText("Its folder Unit 1 stays, with its sets and your progress, under Folders. You can undo this for 30 days.");
    await warning.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("No pages yet. Tap + to make Page 1.")).toBeVisible();
    await expect(links(page, "Folders")).toHaveText([/^Unit 1/]);
    await expect(toast(page)).toContainText("Deleted Page 1.");
    await toast(page).getByRole("button", { name: "Dismiss" }).click();

    await openRecentlyDeleted(page);
    await expect(page.getByRole("list", { name: "Deleted pages" })).toContainText("Unit 1 · Deleted today");
    await page.getByRole("button", { name: "Undo deleting Page 1" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Brought back" })).toHaveText("Brought back Page 1.");
  });

  test("the admin sees a deleted page in Recently deleted without Undo, and no Delete", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "admin on the wide layout");
    await signIn(page);
    const course = await importInto(page, newCourse(), [
      ["Week 1", "Communication", 1],
      ["Week 2", "Anxiety", 1],
    ]);
    const exam1 = await addExamPage(page, course.id, "Exam 1", [folderId(course, "Week 1")]);
    const exam2 = await addExamPage(page, course.id, "Exam 2", [folderId(course, "Week 2")]);
    const preview = (await (await page.request.get(`/api/course-exams/${exam2}/delete-preview`)).json()) as { confirm: string };
    expect((await page.request.delete(`/api/course-exams/${exam2}?${new URLSearchParams({ confirm: preview.confirm }).toString()}`)).status()).toBe(204);

    const admin = await signedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    await admin.goto(`/course/${course.id}/exam-page/${exam1}`);
    await expect(admin.getByRole("heading", { level: 1, name: "Exam 1" })).toBeVisible();
    await expect(admin.getByRole("button", { name: "Edit the page" })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: /^More for / })).toHaveCount(0);

    await admin.goto(`/course/${course.id}`);
    await expect(links(admin, "Pages")).toHaveText([/^Exam 1/]);
    await expect(links(admin, "Folders")).toHaveText([/^Week 2/]);
    // Her More has Rename too; his holds only this, and only now something is deleted.
    await admin.getByRole("button", { name: `More for ${course.code}` }).click();
    await expect(admin.getByRole("menu", { name: course.code }).getByRole("menuitem")).toHaveText(["Recently deleted"]);
    await admin.getByRole("menuitem", { name: "Recently deleted" }).click();
    await expect(admin.getByText("What she deleted in this course in the last 30 days. She can bring each back as it was.")).toBeVisible();
    await expect(admin.getByRole("list", { name: "Deleted pages" })).toContainText("Week 2 · Deleted today");
    await expect(admin.getByRole("button", { name: /^Undo deleting/ })).toHaveCount(0);
    await admin.context().close();
  });
});

async function signedInPage(browser: Browser, email?: string, password?: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, password);
  return page;
}

/** Archives her courses and topics, so the next test's Home and sidebar start clear. */
async function archiveEverything(page: Page): Promise<void> {
  const response = await page.request.get("/api/semesters");
  if (!response.ok()) return;
  const body = (await response.json()) as { semesters: { courses: { id: string; archivedAt: string | null }[] }[]; topics: { id: string; archivedAt: string | null }[] };
  for (const course of [...body.semesters.flatMap((semester) => semester.courses), ...body.topics]) {
    if (course.archivedAt !== null) continue;
    await page.request.patch(`/api/courses/${course.id}`, { data: { archived: true } });
  }
}
