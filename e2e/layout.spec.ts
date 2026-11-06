import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ADMIN_EMAIL, ADMIN_PASSWORD, signIn } from "./sign-in";

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
  archivedAt: string | null;
  courses: { id: string; code: string; archivedAt: string | null }[];
}

function courseCode(): string {
  return `L${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

async function semesters(page: Page): Promise<Semester[]> {
  const response = await page.request.get("/api/semesters");
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { semesters: Semester[] }).semesters;
}

/** Semesters 1 and 2 exist, so a course has another semester to move to. Returns them by number. */
async function twoSemesters(page: Page): Promise<[Semester, Semester]> {
  for (const number of [1, 2]) {
    if (!(await semesters(page)).some((semester) => semester.number === number)) {
      expect((await page.request.post("/api/semesters", { data: { number } })).status()).toBe(201);
    }
  }
  const all = await semesters(page);
  const first = all.find((semester) => semester.number === 1);
  const second = all.find((semester) => semester.number === 2);
  if (first === undefined || second === undefined) throw new Error("semesters 1 and 2 are missing");
  return [first, second];
}

/**
 * Home, one tap from wherever sign-in landed: she lands on the course she used last. The page is
 * loaded again first, so the sidebar and Home read what the test made through the API.
 */
async function openHome(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("navigation", { name: /^(Sections|Tabs)$/ }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
}

/** Opens a screen's + and picks one of its rows. */
async function addFromMenu(page: Page, plus: string, row: string): Promise<void> {
  await page.getByRole("button", { name: plus, exact: true }).click();
  await page.getByRole("menu", { name: plus }).getByRole("menuitem", { name: row, exact: true }).click();
}

function sheet(page: Page, title: string) {
  return page.getByRole("dialog", { name: title });
}

function main(page: Page) {
  return page.getByRole("main");
}

/** The cards in one group on Home, by its heading. */
function cardsIn(page: Page, heading: string) {
  return main(page).locator("section.semester").filter({ has: page.getByRole("heading", { name: heading, exact: true }) }).getByRole("link");
}

test.describe("adding where she is", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("Home's + makes a course in a semester, and the course's and page's + fill it", async ({ page }) => {
    const code = courseCode();
    await signIn(page);
    const [, second] = await twoSemesters(page);
    await openHome(page);

    // New course in Semester 2: a code and a name, then the course opens, empty, with its own +.
    await addFromMenu(page, "Add", `New course in ${second.name}`);
    const make = sheet(page, `New course in ${second.name}`);
    await expect(make.getByRole("textbox", { name: "Course code" })).toBeFocused();
    await make.getByRole("button", { name: "Done" }).click();
    await expect(make.getByRole("alert")).toHaveText("Give the course a code.");
    await make.getByRole("textbox", { name: "Course code" }).fill(code);
    await make.getByRole("textbox", { name: "Course name" }).fill("Layout course");
    await make.getByRole("button", { name: "Done" }).click();
    await expect(page).toHaveURL(/\/course\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: code })).toBeVisible();
    await expect(page.getByText("This course has no question sets yet. Tap + to import a question file.")).toBeVisible();
    const courseId = new URL(page.url()).pathname.split("/")[2] ?? "";

    // Course + › New folder: it is listed under Folders.
    await page.getByRole("button", { name: `Add to ${code}`, exact: true }).click();
    await expect(page.getByRole("menu", { name: `Add to ${code}` }).getByRole("menuitem")).toHaveText([
      /^Import a question file/,
      "New folder",
      "New page",
    ]);
    await page.getByRole("menuitem", { name: "New folder" }).click();
    const folder = sheet(page, "New folder");
    await folder.getByRole("button", { name: "Done" }).click();
    await expect(folder.getByRole("alert")).toHaveText("Give the folder a name.");
    await folder.getByRole("textbox", { name: "Folder name" }).fill("Week 1");
    await folder.getByRole("button", { name: "Done" }).click();
    await expect(folder).toBeHidden();
    await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveText([/^Week 1/]);
    await expect(page.getByText("No pages yet. Tap + to make Page 1.")).toBeVisible();

    // Course + › New page: today's editor, then the page.
    await addFromMenu(page, `Add to ${code}`, "New page");
    const editor = sheet(page, "New page");
    await editor.getByRole("group", { name: "Folders on this page" }).getByRole("button", { name: /^Week 1/ }).click();
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Page 1" })).toBeVisible();

    // Page + › New folder on this page: made on the page in one step.
    await page.getByRole("button", { name: "Add to Page 1", exact: true }).click();
    await expect(page.getByRole("menu", { name: "Add to Page 1" }).getByRole("menuitem")).toHaveText([
      /^Import a question file here/,
      "New folder on this page",
      "Add existing folders",
    ]);
    await page.getByRole("menuitem", { name: "New folder on this page" }).click();
    const onPage = sheet(page, "New folder on Page 1");
    await onPage.getByRole("textbox", { name: "Folder name" }).fill("Week 2");
    await onPage.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("list", { name: "Study material on Page 1" }).getByRole("link")).toHaveText([/^Week 1/, /^Week 2/]);

    // Add existing folders is the page's editor.
    await addFromMenu(page, "Add to Page 1", "Add existing folders");
    await expect(sheet(page, "Edit page")).toBeVisible();
    await sheet(page, "Edit page").getByRole("button", { name: "Cancel" }).click();

    // Import a question file here: Import with the course picked and this page's folders first.
    await addFromMenu(page, "Add to Page 1", "Import a question file here");
    await expect(page).toHaveURL(new RegExp(`/import\\?course=${courseId}&page=[0-9a-f-]{36}$`));
    await expect(page.getByLabel("Course", { exact: true })).toHaveValue(courseId);
    const picker = page.getByRole("radiogroup", { name: "Folder" });
    await expect(picker.getByRole("radio", { name: /^Unsorted/ })).toBeChecked();
    await expect(picker.locator(".folder-picker-title").first()).toHaveText("Page 1");
    await picker.getByRole("radio", { name: "Week 2", exact: true }).check();
    await page.getByLabel("Paste JSON").fill(set("Week 2 - Set 1", 2));
    await page.getByRole("button", { name: "Check file" }).click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText(`“Week 2 - Set 1” · 2 questions in ${code}, Week 2. It is on Page 1.`)).toBeVisible();

    // The course's Import a question file: the course picked, Unsorted picked.
    await page.goto(`/course/${courseId}`);
    await addFromMenu(page, `Add to ${code}`, "Import a question file");
    await expect(page).toHaveURL(`/import?course=${courseId}`);
    await expect(page.getByLabel("Course", { exact: true })).toHaveValue(courseId);
    await expect(page.getByRole("radiogroup", { name: "Folder" }).getByRole("radio", { name: /^Unsorted/ })).toBeChecked();
  });

  test("Home's + adds the next missing semester, and only while one is missing", async ({ page }) => {
    await signIn(page);
    const numbers = (await semesters(page)).map((semester) => semester.number);
    const next = [1, 2, 3].find((number) => !numbers.includes(number));
    await openHome(page);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Add" });
    await expect(menu.getByRole("menuitem", { name: "New study topic" })).toBeVisible();
    if (next === undefined) {
      await expect(menu.getByRole("menuitem", { name: /^Add Semester/ })).toHaveCount(0);
      return;
    }
    await expect(menu.getByRole("menuitem", { name: /^Add Semester/ })).toHaveText([`Add Semester ${String(next)}`]);
    await menu.getByRole("menuitem", { name: `Add Semester ${String(next)}` }).click();
    await expect(main(page).getByRole("heading", { name: `Semester ${String(next)}`, exact: true })).toBeVisible();
    await expect(page.getByText("No courses yet. Tap + to add one, or import its first question file.").first()).toBeVisible();
  });

  test("a course card's menu renames, moves and archives it, and Archived's menu unarchives it", async ({ page }, testInfo) => {
    const code = courseCode();
    await signIn(page);
    const [first, second] = await twoSemesters(page);
    const imported = await page.request.post("/api/imports", {
      data: { source: set("Week 1 - Set 1", 2), folderName: "Week 1", newCourse: { code, title: "Card course", semesterNumber: 1 } },
    });
    expect(imported.status()).toBe(201);
    await openHome(page);
    const card = main(page).getByRole("link", { name: new RegExp(`^${code}`) });
    await expect(cardsIn(page, first.name).filter({ hasText: code })).toHaveCount(1);

    // A right-click opens the same menu as the "…" (a Mac has no long press).
    if (testInfo.project.name === "desktop-chrome") {
      await card.click({ button: "right" });
      await expect(page.getByRole("menu", { name: code })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu", { name: code })).toBeHidden();
    }

    // Rename: the code and the name, nothing else.
    await page.getByRole("button", { name: `Actions for ${code}` }).click();
    const menu = page.getByRole("menu", { name: code });
    await expect(menu.getByRole("menuitem", { name: "Open" })).toBeVisible();
    await expect(menu.getByRole("menuitem").last()).toHaveText("Delete");
    await menu.getByRole("menuitem", { name: "Rename" }).click();
    const rename = sheet(page, "Rename course");
    await expect(rename.getByRole("textbox", { name: "Course code" })).toHaveValue(code);
    await rename.getByRole("textbox", { name: "Course name" }).fill("Card course renamed");
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(rename).toBeHidden();
    await expect(card).toContainText("Card course renamed");

    // Move to Semester 2, and Undo brings it back.
    await page.getByRole("button", { name: `Actions for ${code}` }).click();
    await menu.getByRole("menuitem", { name: `Move to ${second.name}` }).click();
    await expect(page.getByRole("status").filter({ hasText: `Moved ${code} to ${second.name}.` })).toBeVisible();
    await expect(cardsIn(page, second.name).filter({ hasText: code })).toHaveCount(1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(cardsIn(page, first.name).filter({ hasText: code })).toHaveCount(1);

    // Archive asks nothing; it waits in Archived, whose menu unarchives it.
    await page.getByRole("button", { name: `Actions for ${code}` }).click();
    await menu.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Archived ${code}. It is in Archived at the bottom of Home.` })).toBeVisible();
    await expect(cardsIn(page, first.name).filter({ hasText: code })).toHaveCount(0);
    // The card at the bottom can sit over Archived on a phone; she dismisses it, or it goes by itself.
    await page.getByRole("status").getByRole("button", { name: "Dismiss" }).click();
    const archived = main(page).locator("details.archived");
    await archived.getByText("Archived", { exact: true }).click();
    await archived.getByRole("button", { name: `Actions for ${code}` }).click();
    await expect(menu.getByRole("menuitem", { name: "Archive", exact: true })).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "Unarchive" }).click();
    await expect(cardsIn(page, first.name).filter({ hasText: code })).toHaveCount(1);

    // Open goes to the course; its folder and set are where they were.
    await page.getByRole("button", { name: `Actions for ${code}` }).click();
    await menu.getByRole("menuitem", { name: "Open" }).click();
    await expect(page.getByRole("heading", { level: 1, name: code })).toBeVisible();
    await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveText([/^Week 1/]);
  });

  test("Settings keeps semesters' names and dates, and no longer adds anything", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "settings on the wide layout");
    await signIn(page);
    const [first] = await twoSemesters(page);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Semesters", exact: true })).toBeVisible();
    await expect(page.getByLabel(`${first.name} name`)).toHaveValue(first.name);
    await expect(page.getByRole("button", { name: `Save ${first.name}` })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Add Semester/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Add a course/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Study topics" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add a topic" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Connect an agent/ })).toBeVisible();
  });

  test("the admin's frozen Home has the user's + and card menu, and they answer with the note", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "admin on the wide layout");
    const code = courseCode();
    await signIn(page);
    await twoSemesters(page);
    const imported = await page.request.post("/api/imports", {
      data: { source: set("Week 1 - Set 1", 2), folderName: "Week 1", newCourse: { code, title: "Admin course", semesterNumber: 1 } },
    });
    expect(imported.status()).toBe(201);

    const admin = await signedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openHome(admin);
    const card = main(admin).getByRole("link", { name: new RegExp(`^${code}`) });
    await expect(card).toBeVisible();
    await admin.getByRole("button", { name: "Add", exact: true }).click();
    await admin.getByRole("menuitem", { name: "New study topic" }).click();
    await expect(admin.getByText("This is a frozen view of", { exact: false })).toBeVisible();
    await expect(admin.getByRole("dialog")).toHaveCount(0);
    await card.click({ button: "right" });
    await admin.getByRole("menuitem", { name: "Open" }).click();
    await expect(admin.getByRole("heading", { level: 1, name: code })).toBeVisible();
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
