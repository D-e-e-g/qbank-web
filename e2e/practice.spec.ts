import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signIn } from "./sign-in";

const KINDS = ["single", "priority", "sata", "highlight", "order", "match", "matrix", "matrixmulti", "cloze"] as const;

interface Built {
  raw: Record<string, unknown>;
  points: number;
  answer: (page: Page) => Promise<void>;
}

function build(index: number): Built {
  const kind = KINDS[index % KINDS.length] ?? "single";
  const n = String(index + 1);
  const common = {
    id: `Q${n}`,
    type: kind,
    topic: `Topic ${n}`,
    cj: index % 2 === 0 ? "Analyze cues" : "Take action",
    need: "Physiological Adaptation",
    diff: (index % 5) + 1,
    stem: `Invented stem ${n} about a practice client.`,
    ask: `Which choice fits question ${n}?`,
    rationale: `Rationale for question ${n}.`,
    takeaway: `Takeaway for question ${n}.`,
    terms: index === 0 ? ["orthopnea"] : [],
    src: "Invented source",
  };
  switch (kind) {
    case "single":
    case "priority":
      return choiceQuestion(common, n, kind);
    case "sata":
      return sataQuestion(common, n);
    case "highlight":
      return highlightQuestion(common, n);
    case "order":
      return orderQuestion(common, n);
    case "match":
      return matchQuestion(common, n);
    case "matrix":
      return matrixQuestion(common, n);
    case "matrixmulti":
      return matrixMultiQuestion(common, n);
    case "cloze":
      return clozeQuestion(common, n);
  }
}

function choiceQuestion(common: Record<string, unknown>, n: string, kind: "single" | "priority"): Built {
  const correct = `Useful action ${n}`;
  return {
    points: 1,
    raw: {
      ...common,
      type: kind,
      options: [
        { t: correct, ok: true, why: `Because ${n}.` },
        { t: `Distractor A ${n}`, why: "Not this one." },
        { t: `Distractor B ${n}`, why: "Not this one either." },
      ],
    },
    answer: async (page) => {
      await page.getByRole("radio", { name: correct, exact: true }).click();
    },
  };
}

function sataQuestion(common: Record<string, unknown>, n: string): Built {
  const first = `Keep finding ${n}`;
  const second = `Keep the other finding ${n}`;
  return {
    points: 2,
    raw: {
      ...common,
      options: [
        { t: first, ok: true, why: "It belongs." },
        { t: `Skip finding ${n}`, why: "It does not belong." },
        { t: second, ok: true, why: "It belongs too." },
      ],
    },
    answer: async (page) => {
      await page.getByRole("checkbox", { name: first, exact: true }).click();
      await page.getByRole("checkbox", { name: second, exact: true }).click();
    },
  };
}

function highlightQuestion(common: Record<string, unknown>, n: string): Built {
  const keep = `phrase ${n} to keep`;
  const also = `phrase ${n} also kept`;
  return {
    points: 2,
    raw: {
      ...common,
      segments: [
        { t: keep, ok: true, why: "This phrase matters." },
        { t: `phrase ${n} to leave`, why: "This phrase does not." },
        { t: also, ok: true, why: "This phrase matters too." },
      ],
    },
    answer: async (page) => {
      await page.getByRole("button", { name: keep, exact: true }).click();
      await page.getByRole("button", { name: also, exact: true }).click();
    },
  };
}

function orderQuestion(common: Record<string, unknown>, n: string): Built {
  const steps = [`First step ${n}`, `Second step ${n}`, `Third step ${n}`];
  return {
    points: 3,
    raw: {
      ...common,
      items: steps.map((step, index) => ({ t: step, why: `Place ${String(index + 1)}.` })),
    },
    answer: (page) => arrangeOrder(page, steps),
  };
}

function matchQuestion(common: Record<string, unknown>, n: string): Built {
  const pairs = [
    { left: `Drug ${n}`, right: `Class ${n}` },
    { left: `Sign ${n}`, right: `Meaning ${n}` },
  ];
  return {
    points: 2,
    raw: {
      ...common,
      pairs: pairs.map((pair) => ({ l: pair.left, r: pair.right, why: "They match." })),
      extra: [{ r: `Distractor ${n}`, why: "No left item uses this." }],
    },
    answer: async (page) => {
      for (const pair of pairs) {
        await page.getByLabel(`Match for ${pair.left}`).selectOption(pair.right);
      }
    },
  };
}

function matrixQuestion(common: Record<string, unknown>, n: string): Built {
  const rows = [
    { row: `Daily weight ${n}`, column: "Indicated" },
    { row: `Bed rest ${n}`, column: "Not indicated" },
  ];
  return {
    points: 2,
    raw: {
      ...common,
      columns: ["Indicated", "Not indicated"],
      rows: rows.map((row) => ({ t: row.row, ans: row.column, why: "That column fits." })),
    },
    answer: async (page) => {
      for (const row of rows) {
        await page.getByRole("radiogroup", { name: row.row }).getByRole("radio", { name: row.column, exact: true }).click();
      }
    },
  };
}

function matrixMultiQuestion(common: Record<string, unknown>, n: string): Built {
  const rows = [
    { row: `Wheeze ${n}`, columns: ["Asthma"] },
    { row: `Night cough ${n}`, columns: ["Asthma", "Heart failure"] },
  ];
  return {
    points: 3,
    raw: {
      ...common,
      ask: `For each finding ${n}, check every disorder it fits. A finding may fit more than one column.`,
      columns: ["Asthma", "Heart failure"],
      rows: rows.map((row) => ({ t: row.row, ans: row.columns, why: "That column fits." })),
    },
    answer: async (page) => {
      for (const row of rows) {
        const group = page.getByRole("group", { name: row.row, exact: true });
        for (const column of row.columns) {
          await group.getByRole("checkbox", { name: column, exact: true }).click();
        }
      }
    },
  };
}

function clozeQuestion(common: Record<string, unknown>, n: string): Built {
  const first = `upright ${n}`;
  const second = `morning ${n}`;
  return {
    points: 2,
    raw: {
      ...common,
      cloze: {
        text: `Sit the client {0} and weigh her in the {1}.`,
        blanks: [
          { opts: [`flat ${n}`, first], ans: 1, why: "Upright eases breathing." },
          { opts: [second, `evening ${n}`], ans: 0, why: "Morning weight is the comparison." },
        ],
      },
    },
    answer: async (page) => {
      await page.getByLabel("Blank 1").selectOption(first);
      await page.getByLabel("Blank 2").selectOption(second);
    },
  };
}

async function arrangeOrder(page: Page, want: readonly string[]): Promise<void> {
  for (let guard = 0; guard < want.length * want.length; guard += 1) {
    const now = (await page.locator(".order-text").allInnerTexts()).map((text) => text.trim());
    if (now.join("\n") === want.join("\n")) return;
    const target = now.findIndex((text, index) => text !== want[index]);
    const expected = want[target];
    const found = expected === undefined ? -1 : now.indexOf(expected);
    if (target < 0 || found < target) throw new Error(`could not order ${want.join(", ")}`);
    await page.locator(".order-row").nth(found).getByRole("button", { name: "Move up" }).click();
  }
  throw new Error(`order did not settle: ${want.join(", ")}`);
}

async function practice(page: Page, built: Built[], title: string): Promise<{ courseId: string }> {
  const code = `R${Math.random().toString(36).slice(2, 8)}`;
  const response = await page.request.post("/api/imports", {
    data: {
      source: JSON.stringify({
        title,
        desc: "Invented practice set.",
        terms: { orthopnea: ["orthopnea", "Breathing is harder when lying flat."] },
        questions: built.map((item) => item.raw),
      }),
      folderName: "Week 1",
      newCourse: { code, title: "Invented course", semesterNumber: 1 },
    },
  });
  expect(response.ok()).toBeTruthy();
  const imported = (await response.json()) as { courseId: string };
  await page.goto(`/course/${imported.courseId}`);
  await page.getByRole("link", { name: /^Week 1 / }).click();
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByText(`1 of ${String(built.length)}`)).toBeVisible();
  return imported;
}

async function answerAll(page: Page, built: Built[], guessFirst: boolean): Promise<void> {
  for (let index = 0; index < built.length; index += 1) {
    const item = built[index];
    if (!item) continue;
    if (guessFirst && index === 0) await page.getByRole("checkbox", { name: /I'm guessing/ }).check();
    await item.answer(page);
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByRole("status")).toContainText("Correct");
    if (index === 0 && guessFirst) {
      await expect(page.getByRole("status")).toContainText("Flagged as a guess");
      await expect(page.getByText("Rationale for question 1.")).toBeVisible();
      await expect(page.getByText("Takeaway for question 1.")).toBeVisible();
      await expect(page.getByText("Breathing is harder when lying flat.")).toBeVisible();
    }
    await page.getByRole("button", { name: index === built.length - 1 ? "See results" : "Next question" }).click();
  }
}

test.describe("practice runner", () => {
  test.afterEach(async ({ page }) => {
    await archiveCourses(page);
  });

  test("answers all 232 questions correctly", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "full bank on desktop");
    test.setTimeout(360_000);
    const built = Array.from({ length: 232 }, (_, index) => build(index));
    const points = built.reduce((sum, item) => sum + item.points, 0);
    await signIn(page);
    await practice(page, built, "All 232 invented questions");
    await answerAll(page, built, false);
    await expect(page.getByRole("heading", { name: "232 of 232 fully right" })).toBeVisible();
    await expect(page.getByText(`${String(points)} of ${String(points)} points`)).toBeVisible();
    const steps = page.getByRole("list", { name: "By clinical judgment step" });
    await expect(steps.getByRole("listitem").filter({ hasText: "Analyze cues" })).toContainText("116 of 116");
    await expect(steps.getByRole("listitem").filter({ hasText: "Take action" })).toContainText("116 of 116");
    await expect(page.getByRole("list", { name: "Score summary" }).getByRole("listitem").filter({ hasText: "Guessed" })).toContainText("0");
  });

  test("a phone can answer every format, including a guess", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "iphone-safari", "phone layout");
    const built = Array.from({ length: KINDS.length }, (_, index) => build(index));
    const points = built.reduce((sum, item) => sum + item.points, 0);
    await signIn(page);
    await practice(page, built, "One of each format");
    expect(await overflows(page)).toBe(false);
    await answerAll(page, built, true);
    await expect(page.getByRole("heading", { name: `${String(KINDS.length)} of ${String(KINDS.length)} fully right` })).toBeVisible();
    await expect(page.getByText(`${String(points)} of ${String(points)} points`)).toBeVisible();
    await expect(page.getByRole("list", { name: "Score summary" }).getByRole("listitem").filter({ hasText: "Guessed" })).toContainText("1");
    expect(await overflows(page)).toBe(false);
  });

  test("a wrong answer shows the miss, the reason, and the rationale", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "feedback on desktop");
    await signIn(page);
    await practice(page, [build(0)], "One wrong answer");
    await page.getByRole("radio", { name: "Distractor A 1", exact: true }).click();
    await page.getByRole("button", { name: "Check answer" }).click();
    const status = page.getByRole("status");
    await expect(status).toContainText("Not correct");
    await expect(status).not.toContainText("Partly");
    await expect(page.getByText("Missed")).toBeVisible();
    await expect(page.getByText("Because 1.")).toBeVisible();
    await expect(page.getByText("Rationale for question 1.")).toBeVisible();
    await expect(page.getByText("Takeaway for question 1.")).toBeVisible();
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
