import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signIn } from "./sign-in";

// The qbank-server commit the API's contract is pinned from. Its image is the API under test.
const pin = JSON.parse(readFileSync(new URL("../apps/web/contract/pin.json", import.meta.url), "utf8")) as { commit: string };

test("the server serves the shell, and the page can reach the pinned API's /health", async ({ page }) => {
  await signIn(page);

  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page).toHaveTitle("Home · Qbank");
  const health = await page.evaluate(async () => {
    const response = await fetch("/health");
    return (await response.json()) as { status: string; version: string };
  });
  expect(health).toEqual({ status: "ok", version: pin.commit });
});

test("a screen address still loads the shell", async ({ page }) => {
  await signIn(page);
  await page.goto("/course/42");

  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Tabs" }).or(page.getByRole("complementary", { name: "Sidebar" }))).toBeVisible();
});

test("iPhone layout uses bottom tabs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iphone-safari", "phone layout");

  await signIn(page);

  const tabs = page.getByRole("navigation", { name: "Tabs" });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: "Import" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveCount(0);

  await tabs.getByRole("link", { name: "Import" }).click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Import" })).toHaveAttribute("aria-current", "page");
});

test("iPad and Mac layout uses a sidebar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "sidebar layout");

  await signIn(page);

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(sidebar.getByRole("link", { name: "Import" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await expect(sidebar.getByText("Semester 1")).toBeVisible();
  await expect(sidebar.getByText("No courses yet").first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Tabs" })).toHaveCount(0);

  await sidebar.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
});

test("light and dark override the system and stick", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page);
  await page.goto("/settings");

  await page.getByRole("tab", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => canvas(page)).toBe("rgb(12, 12, 11)");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => canvas(page)).toBe("rgb(12, 12, 11)");

  await page.getByRole("tab", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => canvas(page)).toBe("rgb(247, 244, 238)");
});

test("the Look control keeps its own style, one line per label", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");

  const tabs = page.getByRole("tablist", { name: "Look" }).getByRole("tab");
  await expect(tabs).toHaveCount(3);
  for (const tab of await tabs.all()) {
    // The practice highlight passage once shared this class name and gave these tabs a dotted underline.
    await expect(tab).toHaveCSS("border-bottom-style", "none");
    await expect(tab).toHaveCSS("border-radius", "7px");
    expect(await lineCount(tab)).toBe(1);
  }
});

test("match device follows the system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "auto");
  await expect.poll(() => canvas(page)).toBe("rgb(12, 12, 11)");

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => canvas(page)).toBe("rgb(247, 244, 238)");
});

test("the app is installable", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  expect(manifestResponse.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = (await manifestResponse.json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };
  expect(manifest).toMatchObject({ name: "Qbank", short_name: "Qbank", display: "standalone", start_url: "/" });
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512", "512x512"]);
  expect(manifest.icons.map((icon) => icon.purpose).sort()).toEqual(["any", "any", "maskable"]);

  expect(await pngSize(page, "/icons/icon-192.png")).toEqual({ width: 192, height: 192 });
  expect(await pngSize(page, "/icons/icon-512.png")).toEqual({ width: 512, height: 512 });
  expect(await pngSize(page, "/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
});

test("Chromium accepts the manifest", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "manifest parse check is Chromium-only");

  await page.goto("/");
  const session = await page.context().newCDPSession(page);
  const parsed = await session.send("Page.getAppManifest");
  expect(parsed.errors).toEqual([]);
  expect(JSON.parse(parsed.data ?? "{}")).toMatchObject({ name: "Qbank", display: "standalone" });
});

async function canvas(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

async function lineCount(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
}

async function pngSize(page: Page, path: string): Promise<{ width: number; height: number }> {
  const response = await page.request.get(path);
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("image/png");
  const body = await response.body();
  expect(body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}
