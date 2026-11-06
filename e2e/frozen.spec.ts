import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ADMIN_EMAIL, ADMIN_PASSWORD, newAccount, signIn, STUDENT_EMAIL, type FakeAccount } from "./sign-in";

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

function courseCode(): string {
  return `F${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

interface Built {
  code: string;
  courseId: string;
  folderId: string;
  pageId: string;
  setId: string;
}

/** A user account's course: a page with a folder of two sets, one answer in Review, and a deleted set. */
async function buildCourse(user: Page): Promise<Built> {
  const code = courseCode();
  const imported = await user.request.post("/api/imports", {
    data: { source: set("Week 1 - Set 1", 3), folderName: "Week 1", newCourse: { code, title: "Frozen course", semesterNumber: 1 } },
  });
  expect(imported.status()).toBe(201);
  const first = (await imported.json()) as { courseId: string; folderId: string; setId: string };
  const second = await user.request.post("/api/imports", { data: { source: set("Week 1 - Set 2", 2), folderId: first.folderId, courseId: first.courseId } });
  expect(second.status()).toBe(201);
  const doomed = await user.request.post("/api/imports", { data: { source: set("Week 1 - Set 3", 1), folderId: first.folderId, courseId: first.courseId } });
  const doomedSet = ((await doomed.json()) as { setId: string }).setId;
  const preview = await user.request.get(`/api/practice-sets/${doomedSet}/delete-preview`);
  const { confirm } = (await preview.json()) as { confirm: string };
  expect((await user.request.delete(`/api/practice-sets/${doomedSet}?confirm=${encodeURIComponent(confirm)}`)).status()).toBe(204);
  const made = await user.request.post(`/api/courses/${first.courseId}/course-exams`, { data: { name: "Exam 1", folderIds: [first.folderId] } });
  expect(made.status()).toBe(201);
  const page = (await made.json()) as { id: string };
  // Missed once, in the runner, so Review has a row and the set a place to pick up.
  await user.goto(`/course/${first.courseId}/practice/${first.setId}?folder=${first.folderId}`);
  await user.getByRole("radio", { name: "A distractor", exact: true }).click();
  await user.getByRole("button", { name: "Check answer" }).click();
  await expect(user.getByText("Not correct", { exact: true })).toBeVisible();
  return { code, courseId: first.courseId, folderId: first.folderId, pageId: page.id, setId: first.setId };
}

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  return page;
}

/** Every write the page sends from here on, but for its own sign-in. */
function writesOf(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  return writes;
}

async function openAccount(admin: Page, email: string): Promise<void> {
  await admin.goto("/admin");
  await admin.getByRole("list", { name: "User accounts" }).getByRole("button", { name: new RegExp(email) }).click();
  await expect(admin.getByText(`Viewing ${email}`)).toBeVisible();
}

test.describe("the owner's frozen view", () => {
  let user: FakeAccount;
  let userPage: Page;

  test.beforeEach(async ({ browser, page }) => {
    user = await newAccount(browser, "frozen");
    await signIn(page, user.email, user.password);
    userPage = page;
  });

  // The admin's choice stays on the server, and the other specs look at the sample student.
  test.afterEach(async ({ browser }) => {
    const admin = await adminPage(browser);
    const list = (await (await admin.request.get("/api/admin/students")).json()) as { students: { id: string; email: string }[] };
    const student = list.students.find((item) => item.email === STUDENT_EMAIL);
    expect((await admin.request.put("/api/admin/students/viewing", { data: { studentId: student?.id } })).ok()).toBe(true);
    await admin.context().close();
  });

  test("the Admin page lists the accounts, each opening its frozen Home, and no one else has it", async ({ browser }) => {
    const other = await newAccount(browser, "frozen-other");
    const admin = await adminPage(browser);
    await admin.goto("/admin");
    const accounts = admin.getByRole("list", { name: "User accounts" });
    for (const email of [user.email, other.email]) {
      await expect(accounts.getByRole("button", { name: new RegExp(email) })).toContainText("Created today");
    }
    await expect(admin.getByLabel("Temporary password")).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Sign-up list" })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Repair" })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Semesters and courses" })).toHaveCount(0);
    await expect(admin.getByRole("heading", { name: "Study topics" })).toHaveCount(0);

    const row = accounts.getByRole("button", { name: new RegExp(other.email) });
    await row.click();
    await expect(admin.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(admin.getByText(`Viewing ${other.email}`)).toBeVisible();
    await admin.getByRole("link", { name: "Accounts" }).click();
    await expect(admin.getByRole("list", { name: "User accounts" }).getByRole("button", { name: new RegExp(other.email) })).toContainText("Viewing");
    await admin.context().close();

    await userPage.goto("/admin");
    await expect(userPage.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
    await expect(userPage.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await expect(userPage.getByText("Viewing ", { exact: false })).toHaveCount(0);
  });

  test("each control answers with the note and sends no request, and rows open as they do for the user", async ({ browser }) => {
    const built = await buildCourse(userPage);
    const reviewBefore = await (await userPage.request.get(`/api/courses/${built.courseId}/review`)).text();
    const admin = await adminPage(browser);
    await openAccount(admin, user.email);
    const writes = writesOf(admin);
    const note = admin.getByRole("status").getByText(`This is a frozen view of ${user.email}. Nothing here can be changed.`);
    const says = async () => {
      await expect(note).toBeVisible();
      await expect(admin.getByRole("dialog")).toHaveCount(0);
      await admin.getByRole("button", { name: "Dismiss" }).click();
      await expect(note).toHaveCount(0);
    };
    const pick = async (menu: string, item: string) => {
      await admin.getByRole("button", { name: menu, exact: true }).click();
      await admin.getByRole("menuitem", { name: item, exact: true }).click();
      await says();
    };

    // Home.
    await pick("Add", "New study topic");
    await pick(`Actions for ${built.code}`, "Rename");
    await pick(`Actions for ${built.code}`, "Delete");

    // The course.
    await admin.goto(`/course/${built.courseId}`);
    await pick(`More for ${built.code}`, "Rename");
    await pick(`Add to ${built.code}`, "New folder");
    await pick(`Add to ${built.code}`, "New page");

    // Its page.
    await admin.goto(`/course/${built.courseId}/exam-page/${built.pageId}`);
    await pick("More for Exam 1", "Edit page");
    await pick("More for Exam 1", "Delete page");
    await pick("Add to Exam 1", "New folder on this page");
    await admin.getByRole("button", { name: "Edit the page" }).click();
    await says();

    // Its folder.
    await admin.goto(`/course/${built.courseId}/folder/${built.folderId}`);
    await pick("More for Week 1", "Rename");
    await pick("More for Week 1", "Change page");
    await pick("More for Week 1", "Delete folder");
    await admin.getByRole("button", { name: "Select sets" }).click();
    await says();

    // A set opens at the question, and Check answer says the note.
    await admin.getByRole("link", { name: /^Week 1 - Set 2/ }).click();
    await admin.getByRole("radio", { name: "The useful action", exact: true }).click();
    await admin.getByRole("button", { name: "Check answer" }).click();
    await says();
    await expect(admin.getByText("Invented stem 1.")).toBeVisible();
    await admin.getByRole("button", { name: "Close" }).click();

    // A set with an answer offers Start over.
    await admin.getByRole("link", { name: /^Week 1 - Set 1/ }).click();
    await admin.getByRole("button", { name: "Start over" }).click();
    await says();
    await admin.getByRole("button", { name: "Close" }).click();

    // Review, in the user's words.
    await admin.goto(`/course/${built.courseId}/review`);
    await admin.getByRole("button", { name: "Clear the review list" }).click();
    await says();
    await admin.getByRole("button", { name: /Week 1 - Set 1 topic 1/ }).click();
    await expect(admin.getByText("Invented stem 1.")).toBeVisible();
    await admin.goto(`/course/${built.courseId}/review`);

    // Exam setup ticks and reads as the user's does, and Start exam says the note.
    await admin.goto(`/course/${built.courseId}/exam`);
    await admin.getByRole("checkbox", { name: /^Week 1 / }).check();
    await expect(admin.getByText(/from Week 1/)).toBeVisible();
    await admin.getByRole("button", { name: "Start exam" }).click();
    await says();

    // Recently deleted.
    await admin.goto(`/course/${built.courseId}/deleted`);
    await admin.getByRole("button", { name: "Undo deleting Week 1 - Set 3" }).click();
    await says();

    // Import checks a file, and files nothing.
    await admin.goto(`/import?course=${built.courseId}`);
    await admin.getByLabel("Paste JSON").fill(set("Invented import", 1));
    await admin.getByRole("button", { name: "Check file" }).click();
    await admin.getByRole("button", { name: "Import", exact: true }).click();
    await says();

    // Only the check went out, and the user's account has not moved.
    expect(writes).toEqual(["POST /api/imports/check"]);
    expect(await (await userPage.request.get(`/api/courses/${built.courseId}/review`)).text()).toBe(reviewBefore);
    await admin.context().close();
  });

  test("a running exam opens, answers with the note, and stays the user's to end", async ({ browser }) => {
    const built = await buildCourse(userPage);
    const started = await userPage.request.post(`/api/courses/${built.courseId}/exams`, { data: { folderIds: [built.folderId], pool: "all" } });
    expect(started.status()).toBe(201);
    const examId = ((await started.json()) as { id: string }).id;

    const admin = await adminPage(browser);
    await openAccount(admin, user.email);
    const writes = writesOf(admin);
    const note = admin.getByRole("status").getByText(`This is a frozen view of ${user.email}. Nothing here can be changed.`);
    await admin.goto(`/course/${built.courseId}/exam`);
    await admin.getByRole("button", { name: /^Exam in progress/ }).click();
    await admin.getByRole("button", { name: "End exam" }).click();
    await expect(note).toBeVisible();
    await expect(admin.getByRole("dialog")).toHaveCount(0);
    await admin.getByRole("button", { name: "Dismiss" }).click();
    await admin.getByRole("radio").first().click();
    await admin.getByRole("button", { name: "Submit and continue" }).click();
    await expect(note).toBeVisible();
    await admin.getByRole("button", { name: "Skip for now" }).click();
    await admin.getByRole("link", { name: "Accounts" }).click();
    await expect(admin.getByRole("list", { name: "User accounts" })).toBeVisible();
    expect(writes).toEqual([]);

    const exam = (await (await userPage.request.get(`/api/exams/${examId}`)).json()) as { result: unknown; answeredQuestionIds: string[] };
    expect(exam.result).toBeNull();
    expect(exam.answeredQuestionIds).toEqual([]);
    await admin.context().close();
  });
});
