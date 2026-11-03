import { defineConfig, devices } from "@playwright/test";

const ci = process.env.CI !== undefined;

// Runs against the site as the server runs it: the web image and the pinned API image behind
// Caddy, with Postgres. Start it first with `e2e/stack.sh up`, on an empty database. The page is
// localhost, the origin the API trusts (BETTER_AUTH_URL in e2e/compose.yaml).
// One worker: sign-in tests share the sample student password.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/warm-browsers.ts",
  forbidOnly: ci,
  workers: 1,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4318",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "iphone-safari", use: { ...devices["iPhone 15"] } },
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
  ],
});
