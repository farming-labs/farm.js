import { expect, test } from "@playwright/test";

// Regression coverage for the markdown-source middleware bypass. The page at
// /protected-md is authored as markdown (src/app/protected-md/page.md) and the
// root middleware redirects both /protected-md and /protected-md.md to a login
// route. Before the fix, the raw .md source was served before middleware ran, so
// the .md variant returned 200 with the source body and skipped the guard.
test.describe("markdown source respects middleware", () => {
  test("guards the .md source of a middleware-protected page", async ({ request }) => {
    const page = await request.get("/protected-md", { maxRedirects: 0 });
    expect(page.status()).toBe(307);
    expect(page.headers()["location"]).toBe("/protected-md-login");

    const source = await request.get("/protected-md.md", { maxRedirects: 0 });
    expect(source.status()).toBe(307);
    expect(source.headers()["location"]).toBe("/protected-md-login");
    expect(await source.text()).not.toContain("PROTECTED_MARKDOWN_SECRET_BODY");
  });
});
