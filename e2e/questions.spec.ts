import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, signIn } from "./sign-in";

function question(id: string, stem: string): Record<string, unknown> {
  return {
    id,
    type: "single",
    topic: "Fluids",
    cj: "Analyze cues",
    need: "Physiological Adaptation",
    diff: 2,
    stem,
    ask: "Which action comes first?",
    options: [
      { t: "The useful action", ok: true, why: "It addresses the finding." },
      { t: "A distractor", why: "It does not change the finding." },
      { t: "Another distractor", why: "It does not change the finding either." },
    ],
    rationale: "The useful action matches the finding.",
    takeaway: "Match the action to the finding.",
    terms: id === "Q1" ? ["orthopnea"] : [],
    src: "Invented source",
  };
}

function file(title: string, stems: string[]): string {
  return JSON.stringify({
    title,
    desc: "Invented practice set.",
    terms: { orthopnea: ["orthopnea", "Breathing is harder when lying flat."] },
    questions: stems.map((stem, index) => question(`Q${String(index + 1)}`, stem)),
  });
}

test.describe("phone import", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("a bad file is rejected with the runner's message", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "iphone-safari", "phone layout");
    await signIn(page);
    await page.goto("/import");
    await page.getByLabel("Paste JSON").fill("not json");
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByText(/This is not valid JSON:/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy these for your agent" })).toBeVisible();
    expect(await overflows(page)).toBe(false);
  });

  test("she imports from the phone into Unsorted, cancels a replacement, and restores", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "iphone-safari", "phone layout");
    const code = `P${Math.random().toString(36).slice(2, 8)}`;
    const title = "Perfusion practice";

    await signIn(page);
    await page.goto("/import");
    await page.getByLabel("Paste JSON").fill(file(title, ["First invented stem.", "Second invented stem."]));
    await page.getByLabel("Course code").fill(code);
    await page.getByLabel("Course name").fill("Adult Health");
    // A new course has no folder yet: the set goes to Unsorted, which the import makes.
    const folders = page.getByRole("radiogroup", { name: "Folder" });
    await expect(folders.getByRole("radio")).toHaveCount(2);
    await expect(folders.getByRole("radio", { name: "Unsorted new" })).toBeChecked();
    await expect(page.getByText("Pick a folder now, or leave it in Unsorted and move it later.")).toBeVisible();
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByText("Ready: 2 questions, 1 term")).toBeVisible();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Imported" })).toBeVisible();
    await expect(page.getByText(`“${title}” · 2 questions in ${code}, Unsorted. It is in the course’s Folders list until you move it.`)).toBeVisible();
    expect(await overflows(page)).toBe(false);

    // The next file goes to the same course, and to Unsorted again unless she picks a folder.
    await page.getByRole("button", { name: "Import another file" }).click();
    await expect(page.getByLabel("Course", { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
    await expect(folders.getByRole("radio", { name: "Unsorted", exact: true })).toBeChecked();
    await page.getByLabel("Paste JSON").fill(file(title, ["First invented stem.", "A changed invented stem.", "A third invented stem."]));
    await folders.getByRole("radio", { name: "New folder" }).check();
    await page.getByRole("textbox", { name: "New folder name" }).fill("Week 4");
    await page.getByRole("button", { name: "Check file" }).click();
    await page.getByRole("button", { name: "Import", exact: true }).click();

    // A replace keeps the set in its folder, whatever folder she picked.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`${code}, Unsorted already has a set with this name. Replacing swaps its 2 questions for the 3 in this file, and it stays in Unsorted.`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("link", { name: "Home" }).click();
    await page.getByRole("main").getByRole("link", { name: new RegExp(code) }).click();
    await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveText([/^Unsorted1 set · 2 questions/]);
    await page.getByRole("link", { name: /^Unsorted / }).click();
    await expect(page.getByText("Imported today · 2 questions")).toBeVisible();

    await page.goto("/import");
    await page.getByLabel("Paste JSON").fill(file(title, ["First invented stem.", "A changed invented stem.", "A third invented stem."]));
    await page.getByLabel("Course", { exact: true }).selectOption({ label: `${code} · Adult Health` });
    await page.getByRole("button", { name: "Check file" }).click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await dialog.getByRole("button", { name: "Replace" }).click();
    await expect(page.getByRole("heading", { name: "Replaced" })).toBeVisible();
    await page.getByRole("link", { name: "Open Unsorted" }).click();
    await expect(page.getByText("Replaced today · 3 questions")).toBeVisible();

    await page.getByRole("button", { name: `Restore the previous “${title}”` }).click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Replaced today · 3 questions")).toBeVisible();
    await page.getByRole("button", { name: `Restore the previous “${title}”` }).click();
    await dialog.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Restored today · 2 questions")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Unsorted" })).toBeVisible();
    expect(await overflows(page)).toBe(false);
  });
});

test.describe("import into a folder", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("Import here files the set in that folder and says its exam page; the next file defaults to Unsorted", async ({ page }) => {
    const code = `H${Math.random().toString(36).slice(2, 8)}`;
    await signIn(page);
    const first = await page.request.post("/api/imports", {
      data: { source: file("Week 1 - Set 1", ["An invented stem."]), folderName: "Week 1", newCourse: { code, title: "Psych", semesterNumber: 1 } },
    });
    expect(first.status()).toBe(201);
    const { courseId, folderId } = (await first.json()) as { courseId: string; folderId: string };
    const made = await page.request.post(`/api/courses/${courseId}/course-exams`, { data: { name: "Exam 1", folderIds: [folderId] } });
    expect(made.status()).toBe(201);

    await page.goto(`/course/${courseId}/folder/${folderId}`);
    await page.getByRole("link", { name: "Import here" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Import" })).toBeVisible();
    await expect(page.getByLabel("Course", { exact: true })).toHaveValue(courseId);
    const folders = page.getByRole("radiogroup", { name: "Folder" });
    await expect(folders.getByRole("radio", { name: "Week 1" })).toBeChecked();
    // Her folders are grouped by exam page; Unsorted is offered first, made when first used.
    await expect(folders.locator(".folder-chip")).toHaveText(["Unsortednew", "Week 1", "New folder"]);
    await expect(folders.getByText("Exam 1", { exact: true })).toBeVisible();

    await page.getByLabel("Paste JSON").fill(file("Week 1 - Set 2", ["Another invented stem.", "A third invented stem."]));
    await page.getByRole("button", { name: "Check file" }).click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText(`“Week 1 - Set 2” · 2 questions in ${code}, Week 1. It is on Exam 1.`)).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Week 1" })).toHaveAttribute("href", `/course/${courseId}/folder/${folderId}`);

    await page.getByRole("button", { name: "Import another file" }).click();
    await expect(folders.getByRole("radio", { name: "Unsorted new" })).toBeChecked();
    await expect(folders.getByRole("radio", { name: "Week 1" })).not.toBeChecked();
    await page.goto(`/course/${courseId}/folder/${folderId}`);
    await expect(page.getByRole("list", { name: "Sets in Week 1" }).getByRole("link")).toHaveText([/^Week 1 - Set 1/, /^Week 1 - Set 2/]);
    await expect(page.getByText("On Exam 1 · 2 sets · 3 questions")).toBeVisible();
  });
});

test.describe("admin import", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("an admin imports a file into a new course and folder, and sees it read-only", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "admin on the wide layout");
    const code = `A${Math.random().toString(36).slice(2, 8)}`;
    const title = "Mobility practice";

    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/import");
    await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
    await page.getByLabel("Paste JSON").fill(file(title, ["An invented mobility stem."]));
    await page.getByLabel("Course code").fill(code);
    await page.getByLabel("Course name").fill("Foundations");
    await page.getByLabel("Semester").selectOption("2");
    await page.getByRole("radiogroup", { name: "Folder" }).getByRole("radio", { name: "New folder" }).check();
    await page.getByRole("textbox", { name: "New folder name" }).fill("Week 1");
    await page.getByRole("button", { name: "Check file" }).click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Imported" })).toBeVisible();
    await expect(page.getByText(`“${title}” · 1 question in ${code}, Week 1.`)).toBeVisible();

    await page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: new RegExp(code) }).click();
    await expect(page.getByRole("list", { name: "Folders", exact: true }).getByRole("link")).toHaveText([/^Week 1/]);
    await page.getByRole("link", { name: /^Week 1 / }).click();
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByRole("button", { name: "More for Week 1" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);
  });
});

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

async function overflows(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}
