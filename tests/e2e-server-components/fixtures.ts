import { test as base } from "@playwright/test";

export { expect, type Page } from "@playwright/test";

// The contract's tests, with a `request` that opens a connection for each request. Playwright's
// default one reuses idle keep-alive connections without reading the server's `Keep-Alive:
// timeout` hint, so a request sent as the server's idle timeout ends can reach a socket the server
// is closing (a Node server closes an expired idle socket before it reads one that just arrived)
// and fail with "socket hang up" or ECONNRESET. A new connection has no idle timeout to race.
export const test = base.extend({
  request: async ({ playwright, baseURL }, use) => {
    const request = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Connection: "close" },
    });
    await use(request);
    await request.dispose();
  },
});
