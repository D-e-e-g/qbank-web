import { test as base, type BrowserContextOptions } from "@playwright/test";

export { expect } from "@playwright/test";

// Every browser context, the test's own page and each one a test opens, is a device of its own with
// its own address, as on the server. The e2e Caddy (e2e/Caddyfile) hands X-E2E-Address to the API as
// the address it was called from. Sharing one address, the suite would run into the server's limit of
// 3 sign-ins per address in 10 seconds (qbank-server 9ab1b27), which a real device never meets here.
// Specs import `test` and `expect` from here.

const ADDRESS_HEADER = "x-e2e-address";

// Random per worker, so a worker started again after a failure does not reuse the last one's addresses.
let lastDevice = Math.floor(Math.random() * 0xf0_0000);

/** A new address in 10.0.0.0/8. */
function nextAddress(): string {
  lastDevice += 1;
  return ["10", lastDevice >> 16, (lastDevice >> 8) & 0xff, lastDevice & 0xff].map(String).join(".");
}

export const test = base.extend({
  browser: [
    async ({ browser }, use) => {
      const newContext = browser.newContext.bind(browser);
      browser.newContext = (options: BrowserContextOptions = {}) =>
        newContext({ ...options, extraHTTPHeaders: { ...options.extraHTTPHeaders, [ADDRESS_HEADER]: nextAddress() } });
      await use(browser);
    },
    { scope: "worker" },
  ],
});
