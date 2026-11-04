import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signIn } from "./sign-in";

// The agent's side is plain HTTP with no session, as an agent on her computer would send it. QBank lets
// one address start only five pairings in 10 minutes, so this file starts five in all: two on each
// device, for the approval and for the agent that asks to manage, and one on desktop Chrome for the denial.

/** A single-answer set the agent made; option 0 is right. */
function agentSet(title: string): string {
  return JSON.stringify({
    title,
    desc: "Invented practice set.",
    terms: {},
    questions: [1, 2, 3].map((n) => ({
      id: `A${String(n)}`,
      type: "single",
      topic: `Agent topic ${String(n)}`,
      stem: `Invented stem ${String(n)}.`,
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

function unique(prefix: string): string {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`;
}

/** The agent asks to pair, and gets the short code it shows the user. */
async function startPairing(agent: APIRequestContext, name: string, scopes: string[]): Promise<{ deviceCode: string; userCode: string }> {
  const started = await agent.post("/api/agent-pairings", { data: { name, scopes } });
  expect(started.status()).toBe(201);
  return (await started.json()) as { deviceCode: string; userCode: string };
}

async function poll(agent: APIRequestContext, deviceCode: string) {
  return agent.post("/api/agent-pairings/token", { data: { deviceCode } });
}

async function openConnectAnAgent(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: /^(Sections|Tabs)$/ }).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.getByRole("link", { name: /^Connect an agent/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Connect an agent" })).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/agents$/);
  await expect(page).toHaveTitle("Connect an agent · Qbank");
}

function keyRow(page: Page, name: string) {
  return page.getByRole("list", { name: "Your agent keys" }).getByRole("listitem").filter({ hasText: name });
}

test.describe("connect an agent", () => {
  test("she approves her agent's code, its key is listed, the set it imports says so, and she revokes it", async ({ page, request: agent }, testInfo) => {
    const name = unique("Test agent");
    await signIn(page);
    const { deviceCode, userCode } = await startPairing(agent, name, ["import", "read"]);

    await openConnectAnAgent(page);
    if (testInfo.project.name === "desktop-chrome") {
      await expect(page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    } else {
      await expect(page.getByRole("navigation", { name: "Tabs" }).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    }

    // A code nobody is waiting under says so, in the server's words.
    const code = page.getByRole("textbox", { name: "Code" });
    await code.fill("ZZZZ-ZZZZ");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText("No agent is waiting under that code");

    // Typed in any case and without its dash, the code finds the agent: its name, and what it asks to do.
    await code.fill(userCode.toLowerCase().replace("-", ""));
    await page.getByRole("button", { name: "Continue" }).click();
    const request = page.getByRole("group", { name: `${name} asks to connect` });
    await expect(request.getByText(name, { exact: true })).toBeVisible();
    await expect(request.getByText(`Code ${userCode.replace("-", "")} · Works until`)).toBeVisible();
    await expect(request.getByText("Import question sets", { exact: true })).toBeVisible();
    await expect(request.getByText("Read progress, read-only", { exact: true })).toBeVisible();
    await expect(page.getByText(/firstmate/i)).toHaveCount(0);

    // Until the agent picks its key up, nothing is listed and nothing works.
    expect((await poll(agent, deviceCode)).status()).toBe(400);
    await request.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Approved ${name}.` })).toBeVisible();

    // The agent's next poll gets its key, once; the screen lists it without a reload.
    const delivered = await poll(agent, deviceCode);
    expect(delivered.status()).toBe(200);
    const token = ((await delivered.json()) as { token: string }).token;
    expect(token).toMatch(/^qbk_/);
    expect((await poll(agent, deviceCode)).status()).toBe(400);
    await expect(keyRow(page, name)).toContainText("Never used", { timeout: 15_000 });
    await expect(keyRow(page, name)).toContainText("Can import sets and read progress");
    await expect(page.getByText(token)).toHaveCount(0);

    // The agent imports a set with its key into a topic of hers; she imports one herself beside it.
    const madeTopic = await page.request.post("/api/topics", { data: { title: unique("Agent topic") } });
    expect(madeTopic.status()).toBe(201);
    const courseId = ((await madeTopic.json()) as { id: string }).id;
    try {
      const imported = await agent.post("/api/imports", {
        headers: { authorization: `Bearer ${token}` },
        data: { source: agentSet("Agent set"), courseId, folderName: "Week 1" },
      });
      expect(imported.status()).toBe(201);
      const landed = (await imported.json()) as { folderId: string; importedByAgent: { name: string } | null };
      expect(landed.importedByAgent?.name).toBe(name);
      const hers = await page.request.post("/api/imports", { data: { source: agentSet("Her own set"), courseId, folderName: "Week 1" } });
      expect(hers.status()).toBe(201);

      await page.goto(`/course/${courseId}/folder/${landed.folderId}`);
      const sets = page.getByRole("list", { name: "Sets in Week 1" });
      await expect(sets.getByRole("listitem").filter({ hasText: "Agent set" })).toContainText("Imported by your agent");
      await expect(sets.getByRole("listitem").filter({ hasText: "Her own set" })).not.toContainText("Imported by your agent");

      // Its key was used just now; she revokes it, and Cancel first changes nothing.
      await page.goto("/settings/agents");
      await expect(keyRow(page, name)).toContainText("Last used today");
      await keyRow(page, name).getByRole("button", { name: `Revoke ${name}` }).click();
      const sheet = page.getByRole("dialog", { name: `Revoke ${name}?` });
      await expect(sheet).toContainText("The sets it imported stay where they are.");
      await sheet.getByRole("button", { name: "Cancel" }).click();
      await expect(sheet).toBeHidden();
      await keyRow(page, name).getByRole("button", { name: `Revoke ${name}` }).click();
      await sheet.getByRole("button", { name: "Revoke" }).click();
      await expect(page.getByRole("status").filter({ hasText: `Revoked ${name}.` })).toBeVisible();
      await expect(keyRow(page, name)).toContainText("Revoked today");
      await expect(keyRow(page, name).getByRole("button", { name: `Revoke ${name}` })).toHaveCount(0);

      // The key stops working at once; the set it imported stays, still labeled.
      const after = await agent.get("/api/semesters", { headers: { authorization: `Bearer ${token}` } });
      expect(after.status()).toBe(401);
      expect(((await after.json()) as { error: string }).error).toBe("agent_key_revoked");
      await page.goto(`/course/${courseId}/folder/${landed.folderId}`);
      await expect(sets.getByRole("listitem").filter({ hasText: "Agent set" })).toContainText("Imported by your agent");
    } finally {
      await page.request.patch(`/api/courses/${courseId}`, { data: { archived: true } });
    }
  });

  test("she approves an agent that asks to manage her content, and its key says what it can change", async ({ page, request: agent }) => {
    const name = unique("Test agent");
    await signIn(page);
    const { deviceCode, userCode } = await startPairing(agent, name, ["import", "read", "manage"]);

    // Each scope in plain words, the server's, with manage marked as the one that reaches the most.
    await page.goto(`/settings/agents?code=${userCode}`);
    const request = page.getByRole("group", { name: `${name} asks to connect` });
    const scopes = request.getByRole("listitem");
    await expect(scopes).toHaveCount(3);
    await expect(scopes.nth(0)).toContainText("Import question sets");
    await expect(scopes.nth(1)).toContainText("Read progress, read-only");
    const manage = scopes.nth(2);
    await expect(manage.getByText("Add, change, and delete your content", { exact: true })).toBeVisible();
    await expect(manage.getByText("Most access", { exact: true })).toBeVisible();
    await expect(manage).toContainText("Anything it deletes goes to Recently deleted, where you can bring it back for 30 days.");
    await expect(scopes.nth(0).getByText("Most access")).toHaveCount(0);
    await expect(request).toContainText("Its key never answers questions for you, changes a password, or reaches your other keys");
    await expect(request).not.toContainText("deletes anything");
    await expect(page.getByText(/firstmate/i)).toHaveCount(0);

    await request.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Approved ${name}.` })).toBeVisible();
    const delivered = await poll(agent, deviceCode);
    expect(delivered.status()).toBe(200);
    const token = ((await delivered.json()) as { token: string }).token;

    // Your keys says what it can change, and where what it deletes goes.
    const row = keyRow(page, name);
    await expect(row).toContainText("Never used", { timeout: 15_000 });
    await expect(row).toContainText(
      "Can read progress, and add, change, and delete your sets, questions, folders, courses, and topics. What it deletes goes to Recently deleted.",
    );
    await expect(row.getByText("Most access", { exact: true })).toBeVisible();

    // The key makes a topic of hers, as she could herself.
    const made = await agent.post("/api/topics", { headers: { authorization: `Bearer ${token}` }, data: { title: unique("Agent topic") } });
    expect(made.status()).toBe(201);
    const topicId = ((await made.json()) as { id: string }).id;
    try {
      // Revoking says what stays: what it changed, and what it deleted, in Recently deleted.
      await page.reload();
      await expect(row).toContainText("Last used today");
      await row.getByRole("button", { name: `Revoke ${name}` }).click();
      const sheet = page.getByRole("dialog", { name: `Revoke ${name}?` });
      await expect(sheet).toContainText("What it imported or changed stays as it is, and what it deleted stays in Recently deleted.");
      await sheet.getByRole("button", { name: "Revoke" }).click();
      await expect(row).toContainText("Revoked today");
      await expect(row.getByText("Most access")).toHaveCount(0);
    } finally {
      await page.request.patch(`/api/courses/${topicId}`, { data: { archived: true } });
    }
  });

  test("she confirms a code her agent sent in the address, and denies it", async ({ browserName, page, request: agent }) => {
    test.skip(browserName !== "chromium", "pairing starts are limited per address, so the denial runs once, on desktop Chrome");
    const name = unique("Test agent");
    await signIn(page);
    const { deviceCode, userCode } = await startPairing(agent, name, ["import"]);

    await page.goto(`/settings/agents?code=${userCode}`);
    const request = page.getByRole("group", { name: `${name} asks to connect` });
    await expect(request.getByText("Import question sets", { exact: true })).toBeVisible();
    await expect(request.getByText("Read progress, read-only", { exact: true })).toHaveCount(0);
    // The address loses the code, so a reload does not look up a code that was answered already.
    await expect(page).toHaveURL(/\/settings\/agents$/);

    await request.getByRole("button", { name: "Deny" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Denied ${name}. No key was made.` })).toBeVisible();
    const denied = await poll(agent, deviceCode);
    expect(denied.status()).toBe(400);
    expect(((await denied.json()) as { error: string }).error).toBe("access_denied");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Connect an agent" })).toBeVisible();
    await expect(page.getByText("Loading your keys.")).toBeHidden();
    await expect(page.getByText(name)).toHaveCount(0);
  });
});
