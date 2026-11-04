import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ADMIN_EMAIL, ADMIN_PASSWORD, signIn } from "./sign-in";

// Deleting a course or study topic from its card on Home: one question naming it and its
// questions, then Undo right away, or from Home's Recently deleted for 30 days. The server's
// refusals (an exam in progress, a code or name taken since) show in its words.

/** A set of single-answer questions; option 0 is right. */
function set(title: string, size: number): string {
  return JSON.stringify({
    title,
    desc: "Invented practice set.",
    terms: {},
    questions: Array.from({ length: size }, (_, index) => ({
      id: `Q${String(index + 1)}`,
      type: "single",
      topic: `${title} topic ${String(index + 1)}`,
      stem: `Invented stem ${String(index + 1)}.`,
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

interface Semester {
  id: string;
  number: number;
  name: string;
  courses: { id: string; code: string; archivedAt: string | null }[];
}

function uniqueName(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

/** Semester 1, made if she has none yet. */
async function firstSemester(page: Page): Promise<Semester> {
  const read = async () => ((await (await page.request.get("/api/semesters")).json()) as { semesters: Semester[] }).semesters;
  if (!(await read()).some((semester) => semester.number === 1)) {
    expect((await page.request.post("/api/semesters", { data: { number: 1 } })).status()).toBe(201);
  }
  const first = (await read()).find((semester) => semester.number === 1);
  if (first === undefined) throw new Error("no Semester 1");
  return first;
}

/** Imports each [folder, set, size] into a new course in Semester 1, or a new topic. Returns its id. */
async function importInto(page: Page, place: { newCourse: { code: string; title: string; semesterNumber: number } } | { newTopic: { title: string } }, plan: [string, string, number][]): Promise<string> {
  let courseId: string | undefined;
  for (const [folderName, title, size] of plan) {
    const imported = await page.request.post("/api/imports", { data: { source: set(title, size), folderName, ...(courseId === undefined ? place : { courseId }) } });
    expect(imported.status()).toBe(201);
    courseId = ((await imported.json()) as { courseId: string }).courseId;
  }
  if (courseId === undefined) throw new Error("no sets imported");
  return courseId;
}

/** Home, read again so it shows what the test made through the API. */
async function openHome(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.goto("/");
  await page.getByRole("navigation", { name: /^(Sections|Tabs)$/ }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
}

function main(page: Page) {
  return page.getByRole("main");
}

function card(page: Page, name: string) {
  return main(page).getByRole("link", { name: new RegExp(`^${name}`) });
}

/** Opens a card's menu and picks Delete, which is last and red. */
async function deleteFromCard(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  const menu = page.getByRole("menu", { name });
  await expect(menu.getByRole("menuitem").last()).toHaveText("Delete");
  await menu.getByRole("menuitem", { name: "Delete" }).click();
}

/** The Undo offered at the bottom of the screen after a delete. */
function toast(page: Page) {
  return page.getByRole("status").filter({ has: page.getByRole("button", { name: "Dismiss" }) });
}

test.describe("deleting a course or topic", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("she deletes a course after one question, and Recently deleted brings it back with its folders and sets", async ({ page }) => {
    const code = uniqueName("DEL");
    await signIn(page);
    const semester = await firstSemester(page);
    const courseId = await importInto(page, { newCourse: { code, title: "Delete course", semesterNumber: 1 } }, [
      ["Week 1", "Week 1 - Set 1", 3],
      ["Week 2", "Week 2 - Set 1", 2],
    ]);
    await openHome(page);
    await expect(card(page, code)).toBeVisible();

    // One question, naming the course and its questions; Cancel changes nothing.
    await deleteFromCard(page, code);
    const ask = page.getByRole("dialog", { name: `Delete ${code} and its 5 questions?` });
    await expect(ask).toContainText("You can bring it back for 30 days.");
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toBeHidden();
    await expect(card(page, code)).toBeVisible();

    // Delete: the card leaves Home, and Undo is offered at the bottom.
    await deleteFromCard(page, code);
    await ask.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(ask).toBeHidden();
    await expect(card(page, code)).toHaveCount(0);
    await expect(toast(page)).toContainText(`Deleted ${code}.`);
    await toast(page).getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("navigation", { name: /^(Sections|Tabs)$/ }).getByRole("link", { name: new RegExp(`^${code}`) })).toHaveCount(0);

    // Recently deleted, last on Home, lists it with its semester and questions.
    const row = main(page).getByRole("list", { name: "Recently deleted" }).getByRole("link");
    await expect(row).toContainText(/\d+ items? · Undo for 30 days/);
    await row.click();
    await expect(page).toHaveURL("/deleted");
    await expect(page.getByRole("heading", { level: 1, name: "Recently deleted" })).toBeVisible();
    const deleted = page.getByRole("list", { name: "Deleted courses" }).getByRole("listitem").filter({ hasText: code });
    await expect(deleted).toContainText(`${code} · Delete course`);
    await expect(deleted).toContainText(`From ${semester.name} · 5 questions · Deleted today`);

    // Undo brings it back whole: on Home in its semester, with its folders and sets.
    await deleted.getByRole("button", { name: `Undo deleting ${code}` }).click();
    await expect(page.getByRole("status").filter({ hasText: `Brought back ${code}.` })).toBeVisible();
    await expect(page.getByRole("list", { name: "Deleted courses" }).getByRole("listitem").filter({ hasText: code })).toHaveCount(0);
    await main(page).getByRole("link", { name: "Home", exact: true }).click();
    await expect(
      main(page)
        .locator("section.semester")
        .filter({ has: page.getByRole("heading", { name: semester.name, exact: true }) })
        .getByRole("link", { name: new RegExp(`^${code}`) }),
    ).toBeVisible();
    await card(page, code).click();
    await expect(page).toHaveURL(`/course/${courseId}`);
    await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveText([/^Week 1/, /^Week 2/]);
    await page.getByRole("list", { name: "Folders", exact: true }).getByRole("link", { name: /^Week 2/ }).click();
    await expect(page.getByRole("list", { name: "Sets in Week 2" }).getByRole("link")).toHaveText([/^Week 2 - Set 1/]);
  });

  test("a study topic is deleted the same way, and Undo right after brings it back", async ({ page }) => {
    const title = uniqueName("Topic ");
    await signIn(page);
    await importInto(page, { newTopic: { title } }, [["Unit 1", "Unit 1 - Set 1", 1]]);
    await openHome(page);
    await deleteFromCard(page, title);
    const ask = page.getByRole("dialog", { name: `Delete ${title} and its 1 question?` });
    await expect(ask).toContainText("You can bring it back for 30 days.");
    await ask.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(card(page, title)).toHaveCount(0);

    await toast(page).getByRole("button", { name: "Undo", exact: true }).click();
    await expect(toast(page)).toContainText(`Brought back ${title}.`);
    await expect(
      main(page)
        .locator("section.semester")
        .filter({ has: page.getByRole("heading", { name: "Study topics", exact: true }) })
        .getByRole("link", { name: new RegExp(`^${title}`) }),
    ).toBeVisible();
  });

  test("an exam in progress stops a delete, and a code taken since stops Undo, each in the server's words", async ({ page }) => {
    const code = uniqueName("REF");
    await signIn(page);
    const semester = await firstSemester(page);
    const courseId = await importInto(page, { newCourse: { code, title: "Refused course", semesterNumber: 1 } }, [["Week 1", "Week 1 - Set 1", 2]]);
    const detail = (await (await page.request.get(`/api/courses/${courseId}`)).json()) as { folders: { id: string }[] };
    const started = await page.request.post(`/api/courses/${courseId}/exams`, { data: { folderIds: detail.folders.map((folder) => folder.id), pool: "all" } });
    expect(started.status()).toBe(201);
    const examId = ((await started.json()) as { id: string }).id;

    // While the exam goes, the question is replaced by why, with OK and no Delete.
    await openHome(page);
    await deleteFromCard(page, code);
    const ask = page.getByRole("dialog", { name: `Delete ${code} and its 2 questions?` });
    await expect(ask.getByRole("alert")).toHaveText(`An exam in ${code} is still going. Finish or leave that exam first.`);
    await expect(ask.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await ask.getByRole("button", { name: "OK" }).click();
    await expect(ask).toBeHidden();
    await expect(card(page, code)).toBeVisible();

    // Once it ends, the course can go.
    expect((await page.request.post(`/api/exams/${examId}/finish`, { data: { reason: "left" } })).status()).toBe(200);
    await deleteFromCard(page, code);
    await ask.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(card(page, code)).toHaveCount(0);

    // A new course takes its code in the same semester: Undo says why it can't, and is off.
    await importInto(page, { newCourse: { code, title: "Its replacement", semesterNumber: 1 } }, [["Week 1", "Week 1 - Set 1", 1]]);
    const taken = `${semester.name} already has a course with the code ${code}. Rename one of them, then bring this one back.`;
    await toast(page).getByRole("button", { name: "Undo", exact: true }).click();
    await expect(toast(page)).toContainText(taken);
    await page.goto("/deleted");
    const deleted = page.getByRole("list", { name: "Deleted courses" }).getByRole("listitem").filter({ hasText: `${code} · Refused course` });
    await expect(deleted).toContainText(taken);
    await expect(deleted.getByRole("button", { name: `Undo deleting ${code}` })).toBeDisabled();
  });

  test("the admin sees Home's Recently deleted read-only, with no Delete and no Undo", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "admin on the wide layout");
    const code = uniqueName("ADM");
    await signIn(page);
    await firstSemester(page);
    const courseId = await importInto(page, { newCourse: { code, title: "Admin sees it", semesterNumber: 1 } }, [["Week 1", "Week 1 - Set 1", 1]]);
    const preview = (await (await page.request.get(`/api/courses/${courseId}/delete-preview`)).json()) as { confirm: string };
    expect((await page.request.delete(`/api/courses/${courseId}?${new URLSearchParams({ confirm: preview.confirm }).toString()}`)).status()).toBe(204);

    const admin = await signedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openHome(admin);
    await expect(admin.getByRole("button", { name: /^Actions for / })).toHaveCount(0);
    await main(admin).getByRole("list", { name: "Recently deleted" }).getByRole("link").click();
    await expect(admin.getByText("The courses and study topics she deleted in the last 30 days. She can bring each back as it was.")).toBeVisible();
    await expect(admin.getByRole("list", { name: "Deleted courses" }).getByRole("listitem").filter({ hasText: code })).toContainText("Admin sees it");
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
async function archiveCourses(page: Page): Promise<void> {
  const response = await page.request.get("/api/semesters");
  if (!response.ok()) return;
  const body = (await response.json()) as { semesters: Semester[]; topics: { id: string; archivedAt: string | null }[] };
  for (const course of [...body.semesters.flatMap((semester) => semester.courses), ...body.topics]) {
    if (course.archivedAt !== null) continue;
    await page.request.patch(`/api/courses/${course.id}`, { data: { archived: true } });
  }
}
