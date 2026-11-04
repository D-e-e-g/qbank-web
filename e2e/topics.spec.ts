import { expect, test, type Browser, type Page } from "@playwright/test";
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

/** A topic name no earlier test used: her topic names are unique, ignoring case. */
function topicName(): string {
  return `Topic ${Math.random().toString(36).slice(2, 8)}`;
}

async function makeTopic(page: Page, title: string): Promise<string> {
  const made = await page.request.post("/api/topics", { data: { title } });
  expect(made.status()).toBe(201);
  return ((await made.json()) as { id: string }).id;
}

/** A set imported into a folder of a course or topic, through the API as the Import screen would. */
async function importInto(page: Page, target: Record<string, unknown>, title: string, size: number, folderName: string): Promise<{ courseId: string; folderId: string }> {
  const imported = await page.request.post("/api/imports", { data: { source: set(title, size), folderName, ...target } });
  expect(imported.status()).toBe(201);
  return (await imported.json()) as { courseId: string; folderId: string };
}

/** Home, one tap from wherever sign-in landed: she lands on the course she used last. */
async function openHome(page: Page): Promise<void> {
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

test.describe("study topics", () => {
  test.afterEach(async ({ page }) => {
    await archiveEverything(page);
  });

  test("she makes a topic on Home, and it opens like a course, called by its name", async ({ page }, testInfo) => {
    const name = topicName();
    await signIn(page);
    await openHome(page);

    await expect(page.getByRole("heading", { name: "Study topics" })).toBeVisible();
    await addFromMenu(page, "Add", "New study topic");
    const make = sheet(page, "New study topic");
    await expect(make.getByRole("textbox", { name: "Topic name" })).toBeFocused();
    await make.getByRole("button", { name: "Done" }).click();
    await expect(make.getByRole("alert")).toHaveText("Give the topic a name.");
    await make.getByRole("textbox", { name: "Topic name" }).fill(name);
    await make.getByRole("button", { name: "Done" }).click();

    // Done opens it: the course screen, by the topic's name, with Topics to go back.
    await expect(page).toHaveURL(/\/course\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(main(page).getByText("0 questions · 0 folders", { exact: true })).toBeVisible();
    await expect(page.getByText("This topic has no question sets yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Exam/ })).toContainText("Not ready");
    await expect(page).toHaveTitle(`${name} · Qbank`);
    if (testInfo.project.name === "desktop-chrome") {
      await expect(page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    }

    // Back on Home it is a card under Study topics, by its name alone.
    await main(page).getByRole("link", { name: "Topics", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(main(page).getByRole("link", { name: new RegExp(`^${name}`) })).toContainText("0 questions · 0 folders");

    // A second topic of the same name, in any case, is refused, and her typing stays.
    await addFromMenu(page, "Add", "New study topic");
    await make.getByRole("textbox", { name: "Topic name" }).fill(name.toUpperCase());
    await make.getByRole("button", { name: "Done" }).click();
    await expect(make.getByRole("alert")).toContainText("already have a topic named");
    await expect(make.getByRole("textbox", { name: "Topic name" })).toHaveValue(name.toUpperCase());
    await make.getByRole("button", { name: "Cancel" }).click();
    await expect(make).toBeHidden();
  });

  test("she imports a set into a new topic, makes Page 1 with its primer link, and takes an exam over it", async ({ page }) => {
    const name = topicName();
    await signIn(page);
    await page.goto("/import");
    await page.getByLabel("Paste JSON").fill(set("Stage 1 - Set 1", 3));
    await page.getByLabel("Course", { exact: true }).selectOption({ label: "New topic" });
    // A topic is only a name: no code, no semester.
    await expect(page.getByLabel("Course code")).toHaveCount(0);
    await expect(page.getByLabel("Semester")).toHaveCount(0);
    await page.getByLabel("Topic name").fill(name);
    await page.getByRole("button", { name: "Check file" }).click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText(`“Stage 1 - Set 1” · 3 questions in ${name}, Unsorted. It is in the topic’s Folders list until you move it.`)).toBeVisible();

    // The next file goes to the same topic, which Import lists under Study topics.
    await page.getByRole("button", { name: "Import another file" }).click();
    const topicId = await page.getByLabel("Course", { exact: true }).inputValue();
    await expect(page.locator('select[aria-label="Course"] optgroup[label="Study topics"] option')).toContainText([name]);
    await page.goto(`/course/${topicId}`);

    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pages" })).toBeVisible();
    await expect(page.getByText("No pages yet. Tap + to make Page 1.")).toBeVisible();
    await addFromMenu(page, `Add to ${name}`, "New page");
    const editor = sheet(page, "New page");
    await expect(editor.getByRole("textbox", { name: "Page name" })).toHaveValue("Page 1");
    await editor.getByRole("group", { name: "Folders on this page" }).getByRole("button", { name: /^Unsorted/ }).click();
    await expect(editor.getByText("1 folder · 3 questions")).toBeVisible();

    // The primer is a link: the server takes a web address and nothing else, and adds the https:// she left off.
    await editor.getByRole("textbox", { name: "Primer link" }).fill("ftp://notes.example.com/stage-1");
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(editor.getByRole("alert")).toHaveText("A link has to start with https:// or http://.");
    await editor.getByRole("textbox", { name: "Primer link" }).fill("notes.example.com/stage-1");
    await editor.getByRole("button", { name: "Done" }).click();

    // Done opens the page: its primer, Start exam, its folders, and no past exam yet.
    await expect(page.getByRole("heading", { level: 1, name: "Page 1" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/course/${topicId}/exam-page/[0-9a-f-]{36}$`));
    await expect(page.getByText("1 folder · 1 practice set · 3 questions")).toBeVisible();
    const primer = page.getByRole("list", { name: "Primer" }).getByRole("link");
    await expect(primer).toHaveText(/^Open the primernotes\.example\.com/);
    await expect(primer).toHaveAttribute("href", "https://notes.example.com/stage-1");
    await expect(primer).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("list", { name: "Study material on Page 1" }).getByRole("link")).toHaveText([/^Unsorted/]);
    await expect(page.getByText("All 3 questions in this folder, or wrong questions only.")).toBeVisible();
    await expect(page.getByText("Exams you finish over Page 1 show up here with their scores.")).toBeVisible();

    // Its editor keeps the link; the topic lists the page.
    await page.getByRole("button", { name: "Edit the page" }).click();
    await page.getByRole("button", { name: "Name and folders" }).click();
    await expect(sheet(page, "Edit page").getByRole("textbox", { name: "Primer link" })).toHaveValue("https://notes.example.com/stage-1");
    await sheet(page, "Edit page").getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Done editing the page" }).click();
    await main(page).getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Page 1/]);
    await page.getByRole("list", { name: "Pages" }).getByRole("link", { name: /^Page 1/ }).click();

    // The timed exam is the course's: Start exam ticks the page's folders, and the exam runs as in a course.
    await page.getByRole("link", { name: "Start exam" }).click();
    await expect(page.getByText("Page 1 · 1 folder ticked for you")).toBeVisible();
    await expect(main(page).getByRole("link", { name: "Topic", exact: true })).toBeVisible();
    await expect(main(page).getByText(name, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Start exam" }).click();
    await expect(page).toHaveURL(new RegExp(`/course/${topicId}/exam/[0-9a-f-]{36}$`));
    for (const step of ["Submit and continue", "Submit and continue", "Finish exam"]) {
      await page.getByRole("radio", { name: "The useful action", exact: true }).click();
      await page.getByRole("button", { name: step }).first().click();
    }
    await expect(page.getByRole("heading", { name: "3 of 3 fully right" })).toBeVisible();
    await page.getByRole("button", { name: "Back to topic" }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

    // The exam over its folder is the page's past exam.
    await page.getByRole("list", { name: "Pages" }).getByRole("link", { name: /^Page 1/ }).click();
    await expect(page.getByRole("button", { name: /^Unsorted · today/ })).toContainText("3 of 3");
  });

  test("her course and a topic both say pages, and differ only in what they are called", async ({ page }) => {
    const code = `C${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    const name = topicName();
    await signIn(page);
    const course = await importInto(page, { newCourse: { code, title: `${code} course`, semesterNumber: 1 } }, "Week 1 - Set 1", 2, "Week 1");
    const topic = await importInto(page, { courseId: await makeTopic(page, name) }, "Stage 1 - Set 1", 2, "Stage 1");

    const screens = [
      {
        id: course.courseId,
        folderId: course.folderId,
        heading: code,
        back: "Courses",
        note: `${code} course · 2 questions · 1 folder`,
        container: "course",
        Container: "Course",
        setupNote: `${code} · ${code} course`,
        primer: 0,
      },
      {
        id: topic.courseId,
        folderId: topic.folderId,
        heading: name,
        back: "Topics",
        note: "2 questions · 1 folder",
        container: "topic",
        Container: "Topic",
        setupNote: name,
        primer: 1,
      },
    ];
    for (const screen of screens) {
      await page.goto(`/course/${screen.id}`);
      await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
      await expect(main(page).getByRole("link", { name: screen.back, exact: true })).toBeVisible();
      await expect(main(page).getByText(screen.note, { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Pages" })).toBeVisible();
      await expect(page.getByText("No pages yet. Tap + to make Page 1.")).toBeVisible();
      await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveCount(1);
      await expect(page.getByText("Open a folder to see its sets.")).toBeVisible();

      await addFromMenu(page, `Add to ${screen.heading}`, "New page");
      const editor = sheet(page, "New page");
      await expect(editor.getByRole("textbox", { name: "Page name" })).toHaveValue("Page 1");
      await expect(editor.getByText("Tap the folders on this page. A folder on another page is greyed and says which.")).toBeVisible();
      await expect(editor.getByRole("textbox", { name: "Primer link" })).toHaveCount(screen.primer);
      await editor.getByRole("button", { name: "Cancel" }).click();

      await page.goto(`/course/${screen.id}/folder/${screen.folderId}`);
      await expect(page.getByText("On no page · 1 set · 2 questions")).toBeVisible();
      await expect(main(page).getByRole("link", { name: screen.heading, exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Page: none" }).click();
      const pick = sheet(page, "Page");
      await expect(pick.getByRole("radio", { name: `No page Stays in the ${screen.container}’s Folders list` })).toBeChecked();
      await expect(pick.getByRole("radio", { name: "New page Page 1" })).toBeVisible();
      await pick.getByRole("button", { name: "Cancel" }).click();

      await page.goto(`/course/${screen.id}/exam`);
      await expect(main(page).getByRole("link", { name: screen.Container, exact: true })).toBeVisible();
      await expect(main(page).getByText(screen.setupNote, { exact: true })).toBeVisible();
    }
  });

  test("on Home she renames, reorders and archives her topics from their menus, and Archived keeps them closed at the bottom", async ({ page }) => {
    const first = topicName();
    const second = topicName();
    await signIn(page);
    await makeTopic(page, first);
    await makeTopic(page, second);
    const renamed = `${first} renamed`;
    const starts = (...names: string[]) => names.map((name) => new RegExp(`^${name}`));

    // Loaded again, so Home reads the topics made through the API.
    await page.waitForLoadState("networkidle");
    await page.reload();
    await openHome(page);
    const topics = main(page)
      .locator("section.semester")
      .filter({ has: page.getByRole("heading", { name: "Study topics", exact: true }) })
      .getByRole("link");
    await expect(topics).toHaveText(starts(first, second));

    // Rename from the card's menu: only the name changes.
    await page.getByRole("button", { name: `Actions for ${first}` }).click();
    const menu = page.getByRole("menu", { name: first });
    await expect(menu.getByRole("menuitem")).toHaveText(["Open", "Rename", "Move down", "Archive", "Delete"]);
    await menu.getByRole("menuitem", { name: "Rename" }).click();
    const rename = sheet(page, "Rename topic");
    await expect(rename.getByRole("textbox", { name: "Topic name" })).toHaveValue(first);
    await rename.getByRole("textbox", { name: "Topic name" }).fill(renamed);
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(rename).toBeHidden();
    await expect(topics).toHaveText(starts(renamed, second));

    // Move up is her order everywhere: Home, and the server's list.
    await page.getByRole("button", { name: `Actions for ${second}` }).click();
    await page.getByRole("menu", { name: second }).getByRole("menuitem", { name: "Move up" }).click();
    await expect(topics).toHaveText(starts(second, renamed));

    // Archive asks nothing; a card at the bottom says where it went, and its Undo brings it back.
    await page.getByRole("button", { name: `Actions for ${renamed}` }).click();
    await page.getByRole("menu", { name: renamed }).getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Archived ${renamed}. It is in Archived at the bottom of Home.` })).toBeVisible();
    await expect(topics).toHaveText(starts(second));
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(topics).toHaveText(starts(second, renamed));

    // Archived again, it waits in the closed Archived group, whose menu unarchives it.
    await page.getByRole("button", { name: `Actions for ${renamed}` }).click();
    await page.getByRole("menu", { name: renamed }).getByRole("menuitem", { name: "Archive" }).click();
    await expect(topics).toHaveText(starts(second));
    // The card at the bottom can sit over Archived on a phone; she dismisses it, or it goes by itself.
    await page.getByRole("status").getByRole("button", { name: "Dismiss" }).click();
    const archived = main(page).locator("details.archived");
    await expect(archived).not.toHaveAttribute("open");
    await archived.getByText("Archived", { exact: true }).click();
    await expect(archived.getByRole("heading", { name: "Study topics" })).toBeVisible();
    await archived.getByRole("button", { name: `Actions for ${renamed}` }).click();
    await expect(page.getByRole("menu", { name: renamed }).getByRole("menuitem")).toHaveText(["Open", "Rename", "Unarchive", "Delete"]);
    await page.getByRole("menu", { name: renamed }).getByRole("menuitem", { name: "Unarchive" }).click();
    await expect(topics).toHaveText(starts(second, renamed));
  });

  test("the admin sees her topic and its pages read-only", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "admin on the wide layout");
    const name = topicName();
    await signIn(page);
    const topic = await importInto(page, { courseId: await makeTopic(page, name) }, "Stage 1 - Set 1", 2, "Stage 1");
    const made = await page.request.post(`/api/courses/${topic.courseId}/course-exams`, { data: { name: "Page 1", folderIds: [topic.folderId] } });
    expect(made.status()).toBe(201);

    const admin = await signedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(admin.getByRole("heading", { name: "Study topics" })).toBeVisible();
    await expect(admin.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: /^Actions for / })).toHaveCount(0);
    await main(admin).getByRole("link", { name: new RegExp(`^${name}`) }).click();
    await expect(admin.getByText(/progress, read-only\./)).toBeVisible();
    await expect(admin.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(admin.getByRole("button", { name: `More for ${name}` })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: "Rename", exact: true })).toHaveCount(0);
    await expect(admin.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Page 1/]);
    await expect(admin.getByRole("button", { name: `Add to ${name}` })).toHaveCount(0);
    await admin.getByRole("list", { name: "Pages" }).getByRole("link", { name: /^Page 1/ }).click();
    await expect(admin.getByRole("link", { name: "Start exam" })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: "Edit page", exact: true })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: "More for Page 1" })).toHaveCount(0);
    await expect(admin.getByRole("heading", { name: "Her past exams" })).toBeVisible();
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
