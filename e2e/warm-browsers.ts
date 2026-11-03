import { chromium, firefox, webkit, type FullConfig } from "@playwright/test";

// The first page a browser opens on a new machine pays a one-time start that later pages, and later
// launches, do not. On CI's fresh runners it is WebKit's, and it ran inside the first test's 30-second
// timeout: that test took 8.5 to 15.3s where it takes about 3s on desktop, and run 41715582321 spent
// 28.8s in newPage alone and timed out at its first request. A page opened here, before any test,
// pays that start where no test's timeout runs.
export default async function warmBrowsers(config: FullConfig): Promise<void> {
  const types = { chromium, firefox, webkit };
  const names = new Set(config.projects.map((project) => project.use.browserName ?? project.use.defaultBrowserType ?? "chromium"));
  for (const name of names) {
    const browser = await types[name].launch();
    const page = await browser.newPage();
    await page.setContent("<p>Qbank</p>");
    await browser.close();
  }
}
