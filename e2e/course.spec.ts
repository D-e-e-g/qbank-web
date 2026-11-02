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

interface Detail {
  code: string;
  title: string;
  folders: { id: string; name: string; examPageId: string | null; sets: { id: string; title: string; questionIds: string[] }[] }[];
}

interface Course {
  id: string;
  code: string;
  /** Folder ids by name. */
  folders: Record<string, string>;
}

/**
 * Seven weeks, as she has them today: she finished Weeks 1 and 2, is partway through Week 3, and
 * has not started Weeks 4 to 7. Imported into folders named after the weeks and answered through
 * the API, as the Import screen and the runner would.
 */
async function sevenWeekCourse(page: Page): Promise<Course> {
  const code = `F${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const plan: [string, string, number][] = [
    ["Week 1", "Week 1 - Set 1: Communication", 2],
    ["Week 2", "Week 2 - Set 1: Anxiety", 2],
    ["Week 3", "Week 3 - Set 1: Psychosis", 2],
    ["Week 3", "Week 3 - Set 2: Antipsychotics", 3],
    ["Week 4", "Week 4 - Set 1: Substance use", 2],
    ["Week 5", "Week 5 - Set 1: Personality", 2],
    ["Week 6", "Week 6 - Set 1: Adolescents", 2],
    ["Week 7", "Week 7 - Set 1: Crisis", 2],
  ];
  let courseId: string | undefined;
  for (const [week, title, size] of plan) {
    const imported = await page.request.post("/api/imports", {
      data: {
        source: set(title, size),
        folderName: week,
        ...(courseId === undefined ? { newCourse: { code, title: `${code} folders`, semesterNumber: 1 } } : { courseId }),
      },
    });
    expect(imported.status()).toBe(201);
    courseId = ((await imported.json()) as { courseId: string }).courseId;
  }
  if (courseId === undefined) throw new Error("no sets imported");

  const detail = await courseDetail(page, courseId);
  const ids = (title: string) => detail.folders.flatMap((folder) => folder.sets).find((one) => one.title === title)?.questionIds ?? [];
  const answered = [
    ...ids("Week 1 - Set 1: Communication"),
    ...ids("Week 2 - Set 1: Anxiety"),
    ...ids("Week 3 - Set 1: Psychosis"),
    ...ids("Week 3 - Set 2: Antipsychotics").slice(0, 1),
  ];
  for (const questionId of answered) {
    const saved = await page.request.post("/api/attempts", {
      data: { clientAttemptId: crypto.randomUUID(), questionId, response: { type: "single", choice: 0 }, guessed: false },
    });
    expect(saved.status()).toBe(201);
  }
  return { id: courseId, code, folders: Object.fromEntries(detail.folders.map((folder) => [folder.name, folder.id])) };
}

async function courseDetail(page: Page, courseId: string): Promise<Detail> {
  const response = await page.request.get(`/api/courses/${courseId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Detail;
}

function folderIds(course: Course, names: string[]): string[] {
  return names.map((name) => {
    const id = course.folders[name];
    if (id === undefined) throw new Error(`no folder ${name}`);
    return id;
  });
}

/** A folder's row in a list: its link, or in edit mode the row with its up and down buttons. */
function row(page: Page, list: string, name: string) {
  return page.getByRole("list", { name, exact: true }).getByRole("listitem").filter({ has: page.getByText(list, { exact: true }) });
}

function folderLink(page: Page, list: string, name: string) {
  return page.getByRole("list", { name: list, exact: true }).getByRole("link", { name: new RegExp(`^${name} `) });
}

function listRows(page: Page, list: string) {
  return page.getByRole("list", { name: list, exact: true }).getByRole("listitem");
}

function sheet(page: Page, title: string) {
  return page.getByRole("dialog", { name: title });
}

test.describe("course page", () => {
  test("day one: seven weeks are seven folders in today's order, each says how far she is, and opens to its sets", async ({ page }, testInfo) => {
    await signIn(page);
    const course = await sevenWeekCourse(page);
    await page.goto(`/course/${course.id}`);

    await expect(page.getByText(`${course.code} folders · 17 questions · 7 folders`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pages" })).toBeVisible();
    await expect(page.getByText("No pages yet. Tap + to make Page 1.")).toBeVisible();
    const folders = page.getByRole("list", { name: "Folders", exact: true }).getByRole("link");
    await expect(folders).toHaveText([/^Week 1/, /^Week 2/, /^Week 3/, /^Week 4/, /^Week 5/, /^Week 6/, /^Week 7/]);
    await expect(page.getByText("Open a folder to see its sets.")).toBeVisible();

    // Each row says how far she is.
    await expect(folderLink(page, "Folders", "Week 1")).toContainText("1 set · 2 of 2 fully right");
    await expect(folderLink(page, "Folders", "Week 1")).toContainText("Done");
    await expect(folderLink(page, "Folders", "Week 3")).toContainText("2 sets · 3 of 5 answered");
    await expect(folderLink(page, "Folders", "Week 3")).toContainText("3 of 5");
    await expect(folderLink(page, "Folders", "Week 7")).toContainText("1 set · 2 questions");
    await expect(folderLink(page, "Folders", "Week 7")).toContainText("Not started");

    // A folder is its own page: its sets, and back to the course.
    await folderLink(page, "Folders", "Week 3").click();
    await expect(page).toHaveURL(new RegExp(`/course/${course.id}/folder/${course.folders["Week 3"] ?? ""}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Week 3" })).toBeVisible();
    await expect(page.getByText("On no page · 2 sets · 3 of 5 answered")).toBeVisible();
    // On the phone, Home stays selected on the screens under a course.
    if (testInfo.project.name === "iphone-safari") {
      await expect(page.getByRole("navigation", { name: "Tabs" }).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    }
    const sets = page.getByRole("list", { name: "Sets in Week 3" }).getByRole("link");
    await expect(sets).toHaveText([/^Week 3 - Set 1: Psychosis/, /^Week 3 - Set 2: Antipsychotics/]);
    await expect(sets.nth(1)).toContainText("1 of 3 answered");
    await expect(page.locator(".folder-bank")).toHaveCount(0);

    // A set opens from its folder, and closing it comes back here.
    await sets.first().click();
    await expect(page.getByText(/^1 of 2$/)).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Week 3" })).toBeVisible();

    await page.getByRole("link", { name: course.code, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: course.code })).toBeVisible();
    await expect(folders).toHaveCount(7);
  });

  test("she renames a folder, and its sets and progress stay with it", async ({ page }) => {
    await signIn(page);
    const course = await sevenWeekCourse(page);
    await page.goto(`/course/${course.id}/folder/${course.folders["Week 3"] ?? ""}`);

    // Rename is in More at the title, not a pill under it.
    await expect(page.getByRole("button", { name: "Rename", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "More for Week 3" }).click();
    const folderMenu = page.getByRole("menu", { name: "Week 3" });
    await expect(folderMenu.getByRole("menuitem")).toHaveText(["Rename"]);
    await folderMenu.getByRole("menuitem", { name: "Rename" }).click();
    const rename = sheet(page, "Rename folder");
    await expect(rename.getByRole("textbox", { name: "Folder name" })).toHaveValue("Week 3");
    await expect(rename.getByRole("textbox", { name: "Folder name" })).toBeFocused();
    await rename.getByRole("textbox", { name: "Folder name" }).fill("  ");
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(rename.getByRole("alert")).toHaveText("Give the folder a name.");

    // A name another folder of the same list has is refused by the server, and her typing stays.
    await rename.getByRole("textbox", { name: "Folder name" }).fill("week 4");
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(rename.getByRole("alert")).toContainText("Week 4");
    await expect(rename.getByRole("textbox", { name: "Folder name" })).toHaveValue("week 4");

    await rename.getByRole("textbox", { name: "Folder name" }).fill("Psychosis");
    await rename.getByRole("textbox", { name: "Folder name" }).press("Enter");
    await expect(rename).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Psychosis" })).toBeVisible();
    await expect(page.getByText("On no page · 2 sets · 3 of 5 answered")).toBeVisible();
    await expect(page.getByRole("list", { name: "Sets in Psychosis" }).getByRole("link")).toHaveCount(2);

    // Same id, same place in her list, new name.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Psychosis" })).toBeVisible();
    await page.getByRole("link", { name: course.code, exact: true }).click();
    await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveText([
      /^Week 1/,
      /^Week 2/,
      /^Psychosis/,
      /^Week 4/,
      /^Week 5/,
      /^Week 6/,
      /^Week 7/,
    ]);
    await expect(folderLink(page, "Folders", "Psychosis")).toContainText("2 sets · 3 of 5 answered");
    const detail = await courseDetail(page, course.id);
    expect(detail.folders.find((folder) => folder.id === course.folders["Week 3"])?.name).toBe("Psychosis");
  });

  test("she selects sets and moves them to another folder or a new one, with their progress, and deletes the empty folder", async ({ page }) => {
    await signIn(page);
    const course = await sevenWeekCourse(page);
    await page.goto(`/course/${course.id}/folder/${course.folders["Week 3"] ?? ""}`);

    // Select puts a circle on each set; the bar shows once one is ticked.
    await page.getByRole("button", { name: "Select sets" }).click();
    const picks = page.getByRole("list", { name: "Sets in Week 3" }).getByRole("checkbox");
    await expect(picks).toHaveCount(2);
    await expect(page.getByRole("button", { name: /^Move \d/ })).toHaveCount(0);
    await picks.nth(1).check();
    await expect(page.getByRole("button", { name: "Move 1 set" })).toBeVisible();
    await page.getByRole("button", { name: "Move 1 set" }).click();

    const move = sheet(page, "Move to");
    await expect(move.getByText("Moving “Week 3 - Set 2: Antipsychotics” out of Week 3.")).toBeVisible();
    await expect(move.getByRole("radio", { name: /^Week 3 Here now$/ })).toBeDisabled();
    await move.getByRole("button", { name: "Move" }).click();
    await expect(move.getByRole("alert")).toHaveText("Pick a folder to move to.");
    await move.getByRole("radio", { name: /^Week 4 / }).check();
    await move.getByRole("button", { name: "Move" }).click();
    await expect(move).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Moved" })).toHaveText("Moved “Week 3 - Set 2: Antipsychotics” to Week 4.");
    await expect(page.getByRole("list", { name: "Sets in Week 3" }).getByRole("link")).toHaveText([/^Week 3 - Set 1: Psychosis/]);
    await expect(page.getByText("On no page · 1 set · 2 of 2 fully right")).toBeVisible();

    // The last set goes to a new folder, made at the end of her Folders list.
    await page.getByRole("button", { name: "Select sets" }).click();
    await page.getByRole("list", { name: "Sets in Week 3" }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Move 1 set" }).click();
    await move.getByRole("radio", { name: /^New folder/ }).check();
    await expect(move.getByRole("textbox", { name: "New folder name" })).toBeFocused();
    await move.getByRole("button", { name: "Move" }).click();
    await expect(move.getByRole("alert")).toHaveText("Give the new folder a name.");
    await move.getByRole("textbox", { name: "New folder name" }).fill("Psych review");
    await move.getByRole("button", { name: "Move" }).click();
    await expect(move).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Moved" })).toHaveText("Moved “Week 3 - Set 1: Psychosis” to Psych review.");
    await expect(page.getByText("No sets yet. Move sets here, or tap Import here.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Select sets" })).toHaveCount(0);

    // Week 3 is empty now, and the warning says so. Nothing else changes.
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(sheet(page, "Delete Week 3?")).toContainText("It has no sets. You can undo this for 30 days.");
    await sheet(page, "Delete Week 3?").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Deleted" })).toContainText("Deleted Week 3.");
    await expect(page.getByRole("heading", { level: 1, name: course.code })).toBeVisible();
    await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveText([
      /^Week 1/,
      /^Week 2/,
      /^Week 4/,
      /^Week 5/,
      /^Week 6/,
      /^Week 7/,
      /^Psych review/,
    ]);
    // Her answers moved with the sets.
    await expect(folderLink(page, "Folders", "Week 4")).toContainText("2 sets · 1 of 5 answered");
    await expect(folderLink(page, "Folders", "Psych review")).toContainText("1 set · 2 of 2 fully right");
    await expect(page.getByText(`${course.code} folders · 17 questions · 7 folders`)).toBeVisible();

    // The moved set still opens, with its answers.
    await folderLink(page, "Folders", "Week 4").click();
    await expect(page.getByRole("list", { name: "Sets in Week 4" }).getByRole("link", { name: /^Week 3 - Set 2: Antipsychotics/ })).toContainText(
      "1 of 3 answered",
    );
  });

  test("she puts her folders in her own order with up and down or by dragging, and it survives a reload", async ({ page }) => {
    await signIn(page);
    const course = await sevenWeekCourse(page);
    await page.goto(`/course/${course.id}`);

    await page.getByRole("button", { name: "Edit folder order" }).click();
    await expect(page.getByText("Drag a folder by its handle, or move it up or down.")).toBeVisible();
    // In edit mode the rows stop opening; each has up, down, and a grip.
    await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Move Week 1 up" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Move Week 7 down" })).toBeDisabled();

    await page.getByRole("button", { name: "Move Week 4 up" }).click();
    await expect(page.getByRole("status").filter({ hasText: "moved to" })).toHaveText("Week 4 moved to 3 of 7.");
    // From the keyboard, the button keeps focus after its row moves, so she can press it again.
    const week1Down = page.getByRole("button", { name: "Move Week 1 down" });
    await week1Down.focus();
    await week1Down.press("Enter");
    await expect(listRows(page, "Folders")).toHaveText([/^Week 2/, /^Week 1/, /^Week 4/, /^Week 3/, /^Week 5/, /^Week 6/, /^Week 7/]);
    await expect(week1Down).toBeFocused();

    // Dragging Week 7 by its grip two rows up puts it after Week 3.
    const grip = row(page, "Week 7", "Folders").locator(".list-grip");
    const box = await grip.boundingBox();
    const height = (await row(page, "Week 6", "Folders").boundingBox())?.height ?? 0;
    if (box === null || height === 0) throw new Error("no grip to drag");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - height * 2, { steps: 8 });
    await expect(row(page, "Week 7", "Folders")).toHaveClass(/list-row-lifted/);
    await page.mouse.up();
    await expect(listRows(page, "Folders")).toHaveText([/^Week 2/, /^Week 1/, /^Week 4/, /^Week 3/, /^Week 7/, /^Week 5/, /^Week 6/]);
    await expect(row(page, "Week 7", "Folders")).not.toHaveClass(/list-row-lifted/);

    // Three quick taps send their saves one after another, so the server ends on the order she sees.
    for (let tap = 0; tap < 3; tap += 1) await page.getByRole("button", { name: "Move Week 6 up" }).click();
    await expect(listRows(page, "Folders")).toHaveText([/^Week 2/, /^Week 1/, /^Week 4/, /^Week 6/, /^Week 3/, /^Week 7/, /^Week 5/]);

    await page.getByRole("button", { name: "Done ordering folders" }).click();
    await expect(page.getByText("Open a folder to see its sets.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveText([
      /^Week 2/,
      /^Week 1/,
      /^Week 4/,
      /^Week 6/,
      /^Week 3/,
      /^Week 7/,
      /^Week 5/,
    ]);
  });
});

/** An exam she took and finished over these folders, through the API as the exam screen would. */
async function takeExam(page: Page, courseId: string, folderIdList: string[]): Promise<void> {
  const started = await page.request.post(`/api/courses/${courseId}/exams`, { data: { folderIds: folderIdList, pool: "all" } });
  expect(started.status()).toBe(201);
  const { id } = (await started.json()) as { id: string };
  const finished = await page.request.post(`/api/exams/${id}/finish`, { data: { reason: "left" } });
  expect(finished.status()).toBe(200);
}

async function addExamPage(page: Page, courseId: string, name: string, folderIdList: string[]): Promise<string> {
  const made = await page.request.post(`/api/courses/${courseId}/course-exams`, { data: { name, folderIds: folderIdList } });
  expect(made.status()).toBe(201);
  return ((await made.json()) as { id: string }).id;
}

function chip(page: Page, title: string, name: string) {
  return sheet(page, title).getByRole("group", { name: "Folders on this page" }).getByRole("button", { name: new RegExp(`^${name}`) });
}

test.describe("pages", () => {
  test("she makes Exam 1 from her folders, finds the exam she already took over them, and starts one with them ticked", async ({ page }) => {
    await signIn(page);
    const course = await sevenWeekCourse(page);
    await takeExam(page, course.id, folderIds(course, ["Week 1", "Week 2", "Week 3"]));
    await takeExam(page, course.id, folderIds(course, ["Week 3", "Week 4"]));
    await page.goto(`/course/${course.id}`);

    await page.getByRole("button", { name: `Add to ${course.code}` }).click();
    await page.getByRole("menuitem", { name: "New page" }).click();
    const editor = sheet(page, "New page");
    // A new page is Page 1 in a course too, and asks for no badge; she names it Exam 1.
    await expect(editor.getByRole("textbox", { name: "Page name" })).toHaveValue("Page 1");
    await expect(editor.getByRole("tablist", { name: "Badge" })).toHaveCount(0);
    await editor.getByRole("textbox", { name: "Page name" }).fill("Exam 1");
    await expect(editor.getByText("No folders yet")).toBeVisible();
    for (const week of ["Week 1", "Week 2", "Week 3"]) await chip(page, "New page", week).click();
    await expect(chip(page, "New page", "Week 2")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "New page", "Week 4")).toHaveAttribute("aria-pressed", "false");
    await expect(editor.getByText("3 folders · 9 questions")).toBeVisible();
    await editor.getByRole("button", { name: "Done" }).click();

    // Done opens the new page: Start exam, its folders, and the exam over the same folders she took before.
    await expect(page.getByRole("heading", { level: 1, name: "Exam 1" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/course/${course.id}/exam-page/[0-9a-f-]{36}$`));
    await expect(page.getByText("3 folders · 4 practice sets · 9 questions")).toBeVisible();
    await expect(page.getByRole("list", { name: "Study material on Exam 1" }).getByRole("link")).toHaveText([/^Week 1/, /^Week 2/, /^Week 3/]);
    await expect(page.getByText("All 9 questions in these 3 folders, or Wrong questions only.")).toBeVisible();
    await expect(page.getByText(/Exam twins:/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Past exams" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Week 1, Week 2, Week 3 · today/ })).toBeVisible();
    // The exam over Weeks 3 and 4 spans Exam 1 and a loose folder, so it is not on the page.
    await expect(page.getByRole("button", { name: /^Week 3, Week 4 · / })).toHaveCount(0);

    // On the course page, Exam 1 is a row and its folders have left the Folders list.
    await page.getByRole("link", { name: course.code, exact: true }).click();
    await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Exam 1/]);
    await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toContainText("3 folders · 9 questions");
    await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveText([/^Week 4/, /^Week 5/, /^Week 6/, /^Week 7/]);
    await expect(page.getByText("Folders on no page. Open one to see its sets.")).toBeVisible();

    // A folder on the page goes back to the page.
    await page.getByRole("list", { name: "Pages" }).getByRole("link", { name: /^Exam 1/ }).click();
    await folderLink(page, "Study material on Exam 1", "Week 2").click();
    await expect(page.getByText("On Exam 1 · 1 set · 2 of 2 fully right")).toBeVisible();
    await expect(page.getByRole("button", { name: "Page: Exam 1" })).toBeVisible();
    await page.getByRole("link", { name: "Exam 1", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Exam 1" })).toBeVisible();

    // Two taps: Start exam opens Exam setup with Weeks 1-3 ticked, then Start exam.
    await page.getByRole("link", { name: "Start exam" }).click();
    await expect(page.getByText("Exam 1 · 3 folders ticked for you")).toBeVisible();
    const exam1 = page.getByRole("list", { name: "Exam 1", exact: true });
    await expect(exam1.getByRole("checkbox")).toHaveCount(3);
    for (const week of ["Week 1", "Week 2", "Week 3"]) await expect(exam1.getByRole("checkbox", { name: new RegExp(`^${week} `) })).toBeChecked();
    await expect(page.getByRole("list", { name: "On no page" }).getByRole("checkbox", { name: /^Week 4 / })).not.toBeChecked();
    await expect(page.getByText("2 from Week 1 · 2 from Week 2 · 5 from Week 3")).toBeVisible();
    await page.getByRole("button", { name: "Start exam" }).click();
    await expect(page).toHaveURL(new RegExp(`/course/${course.id}/exam/[0-9a-f-]{36}$`));

    // From the Exam tile, Exam setup is as before: nothing ticked.
    await page.goto(`/course/${course.id}/exam`);
    await expect(page.getByText(/ticked for you/)).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /^Week 1 / })).not.toBeChecked();
  });

  test("a folder's Page sheet moves it between pages, the editor greys another page's folders, and deleting a page keeps its folders", async ({ page }) => {
    await signIn(page);
    const course = await sevenWeekCourse(page);
    const exam1 = await addExamPage(page, course.id, "Exam 1", folderIds(course, ["Week 1", "Week 2", "Week 3"]));

    // From Week 4's page she makes Page 2 with it on.
    await page.goto(`/course/${course.id}/folder/${course.folders["Week 4"] ?? ""}`);
    await page.getByRole("button", { name: "Page: none" }).click();
    const pick = sheet(page, "Page");
    await expect(pick.getByRole("radio", { name: /^No page/ })).toBeChecked();
    await expect(pick.getByRole("radio", { name: /^Exam 1 / })).toHaveAccessibleName("Exam 1 3 folders · 4 practice sets · 9 questions");
    await pick.getByRole("radio", { name: /^New page Page 2$/ }).check();
    await pick.getByRole("button", { name: "Done" }).click();
    await expect(pick).toBeHidden();
    await expect(page.getByText("On Page 2 · 1 set · 2 questions")).toBeVisible();
    await expect(page.getByRole("link", { name: "Page 2", exact: true })).toBeVisible();

    // Week 5 goes on Exam 1 the same way.
    await page.goto(`/course/${course.id}/folder/${course.folders["Week 5"] ?? ""}`);
    await page.getByRole("button", { name: "Page: none" }).click();
    await pick.getByRole("radio", { name: /^Exam 1 / }).check();
    await pick.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("On Exam 1 · 1 set · 2 questions")).toBeVisible();

    // On Exam 1, Edit then Name and folders: Week 4 is greyed and names Page 2.
    await page.goto(`/course/${course.id}/exam-page/${exam1}`);
    await expect(page.getByRole("list", { name: "Study material on Exam 1" }).getByRole("link")).toHaveText([/^Week 1/, /^Week 2/, /^Week 3/, /^Week 5/]);
    await page.getByRole("button", { name: "Edit the page" }).click();
    await page.getByRole("button", { name: "Move Week 5 up" }).click();
    await expect(listRows(page, "Study material on Exam 1")).toHaveText([/^Week 1/, /^Week 2/, /^Week 5/, /^Week 3/]);
    await page.getByRole("button", { name: "Name and folders" }).click();
    const editor = sheet(page, "Edit page");
    await expect(chip(page, "Edit page", "Week 4")).toBeDisabled();
    await expect(chip(page, "Edit page", "Week 4")).toHaveText("Week 4Page 2");
    await editor.getByRole("textbox", { name: "Page name" }).fill("Midterm");
    await chip(page, "Edit page", "Week 1").click();
    await expect(editor.getByText("3 folders · 9 questions")).toBeVisible();

    // Another device puts Week 6 on Page 2 while the sheet is open: Done shows the refusal and keeps her edits.
    await chip(page, "Edit page", "Week 6").click();
    const week6 = await page.request.patch(`/api/folders/${course.folders["Week 6"] ?? ""}`, {
      data: { examPageId: (await courseDetail(page, course.id)).folders.find((folder) => folder.name === "Week 4")?.examPageId },
    });
    expect(week6.status()).toBe(200);
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(editor.getByRole("alert")).toHaveText("Week 6 is in Page 2.");
    await expect(chip(page, "Edit page", "Week 6")).toHaveAttribute("aria-pressed", "true");
    await chip(page, "Edit page", "Week 6").click();
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Midterm" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Study material on Midterm" }).getByRole("listitem")).toHaveText([/^Week 2/, /^Week 5/, /^Week 3/]);

    // Week 1 left the page for the end of the course's Folders list.
    await page.getByRole("link", { name: course.code, exact: true }).click();
    await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Midterm/, /^Page 2/]);
    await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveText([/^Week 7/, /^Week 1/]);

    // Deleting Page 2 puts its folders at the end of the Folders list; their sets are untouched.
    await page.getByRole("list", { name: "Pages" }).getByRole("link", { name: /^Page 2/ }).click();
    await page.getByRole("button", { name: "Edit the page" }).click();
    await page.getByRole("button", { name: "Name and folders" }).click();
    await sheet(page, "Edit page").getByRole("button", { name: "Delete this page" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete Page 2?" });
    await expect(confirm).toContainText("Its 2 folders stay, with their sets and your progress, under Folders: Week 4 and Week 6. You can undo this for 30 days.");
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: course.code })).toBeVisible();
    await expect(page.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Midterm/]);
    await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveText([/^Week 7/, /^Week 1/, /^Week 4/, /^Week 6/]);
    await folderLink(page, "Folders", "Week 4").click();
    await expect(page.getByRole("list", { name: "Sets in Week 4" }).getByRole("link", { name: /^Week 4 - Set 1: Substance use/ })).toBeVisible();

    // A folder already on a page can start a new one: it leaves Midterm for the new Page 2.
    await page.goto(`/course/${course.id}/folder/${course.folders["Week 5"] ?? ""}`);
    await page.getByRole("button", { name: "Page: Midterm" }).click();
    await pick.getByRole("radio", { name: /^New page Page 2$/ }).check();
    await pick.getByRole("button", { name: "Done" }).click();
    await expect(pick).toBeHidden();
    await expect(page.getByText("On Page 2 · 1 set · 2 questions")).toBeVisible();
    await page.getByRole("link", { name: "Page 2", exact: true }).click();
    await expect(page.getByRole("list", { name: "Study material on Page 2" }).getByRole("link")).toHaveText([/^Week 5/]);
  });

  test("the admin sees the same pages and folders, read-only", async ({ page, browser }) => {
    await signIn(page);
    const course = await sevenWeekCourse(page);
    const exam1 = await addExamPage(page, course.id, "Exam 1", folderIds(course, ["Week 1", "Week 2", "Week 3"]));

    const admin = await signedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    await admin.goto(`/course/${course.id}`);
    await expect(admin.getByText(/progress, read-only\./)).toBeVisible();
    await expect(admin.getByRole("list", { name: "Pages" }).getByRole("link")).toHaveText([/^Exam 1/]);
    await expect(admin.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveText([/^Week 4/, /^Week 5/, /^Week 6/, /^Week 7/]);
    await expect(admin.getByRole("button", { name: `Add to ${course.code}` })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: `More for ${course.code}` })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: "Rename", exact: true })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: "Edit folder order" })).toHaveCount(0);

    await admin.goto(`/course/${course.id}/exam-page/${exam1}`);
    await expect(admin.getByRole("heading", { level: 1, name: "Exam 1" })).toBeVisible();
    await expect(admin.getByRole("link", { name: "Start exam" })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: "Edit the page" })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: "Edit page", exact: true })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: "More for Exam 1" })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: "Add to Exam 1" })).toHaveCount(0);
    await expect(admin.getByRole("heading", { name: "Her past exams" })).toBeVisible();

    await folderLink(admin, "Study material on Exam 1", "Week 3").click();
    await expect(admin.getByText("On Exam 1 · 2 sets · 3 of 5 answered")).toBeVisible();
    await expect(admin.getByText("Week 3 - Set 2: Antipsychotics")).toBeVisible();
    await expect(admin.getByRole("link", { name: /^Week 3 - Set/ })).toHaveCount(0);
    for (const action of ["More for Week 3", "Rename", "Select sets", "Page: Exam 1"]) await expect(admin.getByRole("button", { name: action })).toHaveCount(0);
    await expect(admin.getByRole("link", { name: "Import here" })).toHaveCount(0);
    await admin.context().close();
  });

  test("she sets a page's badge, sees its tag in Pages, and clears it", async ({ page }) => {
    await signIn(page);
    const code = `B${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    const imported = await page.request.post("/api/imports", {
      data: {
        source: set("Week 1 - Set 1: Communication", 2),
        folderName: "Week 1",
        newCourse: { code, title: `${code} badges`, semesterNumber: 1 },
      },
    });
    expect(imported.status()).toBe(201);
    const courseId = ((await imported.json()) as { courseId: string }).courseId;
    const week1 = (await courseDetail(page, courseId)).folders[0]?.id;
    if (week1 === undefined) throw new Error("no folder");
    const exam1 = await addExamPage(page, courseId, "Exam 1", [week1]);

    // A new page has no badge. She sets Concept in the editor.
    await page.goto(`/course/${courseId}/exam-page/${exam1}`);
    await page.getByRole("button", { name: "Edit the page" }).click();
    await page.getByRole("button", { name: "Name and folders" }).click();
    const editor = sheet(page, "Edit page");
    await expect(editor.getByRole("tab", { name: "None" })).toHaveAttribute("aria-selected", "true");
    await editor.getByRole("tab", { name: "Concept" }).click();
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(editor).toBeHidden();

    // The course's Pages list shows the tag beside the page's name.
    await page.goto(`/course/${courseId}`);
    const row = page.getByRole("list", { name: "Pages" }).getByRole("link", { name: /^Exam 1/ });
    await expect(row.locator(".list-tag")).toHaveText("Concept");

    // None takes the badge off, and the tag goes.
    await row.click();
    await page.getByRole("button", { name: "Edit the page" }).click();
    await page.getByRole("button", { name: "Name and folders" }).click();
    await expect(editor.getByRole("tab", { name: "Concept" })).toHaveAttribute("aria-selected", "true");
    await editor.getByRole("tab", { name: "None" }).click();
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(editor).toBeHidden();
    await page.goto(`/course/${courseId}`);
    const cleared = page.getByRole("list", { name: "Pages" }).getByRole("link", { name: /^Exam 1/ });
    await expect(cleared).toBeVisible();
    await expect(cleared.locator(".list-tag")).toHaveCount(0);
  });
});

async function signedInPage(browser: Browser, email?: string, password?: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, password);
  return page;
}
