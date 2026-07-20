import { expect, test } from "@playwright/test";

function expectVaryIncludes(vary: string | undefined, expected: string[]) {
  const values = new Set(
    (vary ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  for (const value of expected) expect(values).toContain(value.toLowerCase());
}

test.describe("Farm internationalization", () => {
  test("resolves signals, canonicalizes URLs, and preserves cache boundaries", async ({
    request,
  }) => {
    const browserDetected = await request.get("/", {
      headers: { "accept-language": "am-ET, en;q=0.8" },
      maxRedirects: 0,
    });
    expect(browserDetected.status()).toBe(307);
    expect(browserDetected.headers().location).toBe("/am");
    expect(browserDetected.headers()["cache-control"]).toBe("private, no-store");
    expectVaryIncludes(browserDetected.headers().vary, [
      "Accept-Encoding",
      "Cookie",
      "Accept-Language",
    ]);
    expect(browserDetected.headers()["set-cookie"]).toContain("farm_locale=am");

    const cookieDetected = await request.get("/", {
      headers: {
        cookie: "farm_locale=ar",
        "accept-language": "am",
      },
      maxRedirects: 0,
    });
    expect(cookieDetected.status()).toBe(307);
    expect(cookieDetected.headers().location).toBe("/ar");

    const explicitLocale = await request.get("/am", {
      headers: {
        cookie: "farm_locale=ar",
        "accept-language": "en",
      },
    });
    expect(explicitLocale.status()).toBe(200);
    expect(explicitLocale.headers()["cache-control"]).toContain("public");
    expectVaryIncludes(explicitLocale.headers().vary, ["Accept-Encoding"]);
    expect(explicitLocale.headers().vary).not.toContain("Cookie");
    expect(explicitLocale.headers().vary).not.toContain("Accept-Language");
    expect(explicitLocale.headers()["set-cookie"]).toBeUndefined();

    const html = await explicitLocale.text();
    expect(html).toContain('<html lang="am" dir="ltr">');
    expect(html).toContain("አንድ መተግበሪያ፣ ለሁሉም ቋንቋ");
    expect(html).toContain('hreflang="en" href="/"');
    expect(html).toContain('hreflang="am" href="/am"');
    expect(html).toContain('hreflang="ar" href="/ar"');
    expect(html).toContain('hreflang="x-default" href="/"');

    const defaultPrefix = await request.get("/en", { maxRedirects: 0 });
    expect(defaultPrefix.status()).toBe(307);
    expect(defaultPrefix.headers().location).toBe("/");

    const localeCase = await request.get("/AM", { maxRedirects: 0 });
    expect(localeCase.status()).toBe(307);
    expect(localeCase.headers().location).toBe("/am");
  });

  test("provides localized API context without changing the API URL", async ({ request }) => {
    const browserDetected = await request.get("/api/locale", {
      headers: { "accept-language": "am" },
    });
    expect(browserDetected.status()).toBe(200);
    await expect(browserDetected.json()).resolves.toEqual({
      locale: "am",
      source: "accept-language",
      message: expect.stringContaining("ጉብኝቶች"),
    });
    expect(browserDetected.headers()["cache-control"]).toBe("private, no-store");
    expectVaryIncludes(browserDetected.headers().vary, [
      "Accept-Encoding",
      "Cookie",
      "Accept-Language",
    ]);

    const cookieDetected = await request.get("/api/locale", {
      headers: {
        cookie: "farm_locale=ar",
        "accept-language": "am",
      },
    });
    expect(cookieDetected.status()).toBe(200);
    await expect(cookieDetected.json()).resolves.toEqual({
      locale: "ar",
      source: "cookie",
      message: expect.stringContaining("زيارات"),
    });
  });

  test("hydrates translated content and switches persisted RTL locale", async ({
    context,
    page,
  }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "One application, every locale",
    );
    await expect(page.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: "Amharic" }).click();
    await expect(page).toHaveURL(/\/am$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "am");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("አንድ መተግበሪያ፣ ለሁሉም ቋንቋ");
    await expect(page.getByRole("button", { name: "አማርኛ" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(() => page.evaluate(() => window.__FARM_I18N__?.locale)).toBe("am");

    await page.getByRole("button", { name: "ዓረብኛ" }).click();
    await expect(page).toHaveURL(/\/ar$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("تطبيق واحد لكل لغة");
    await expect(page.getByRole("button", { name: "العربية" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(() => page.evaluate(() => window.__FARM_I18N__?.locale)).toBe("ar");

    const localeCookie = (await context.cookies()).find((cookie) => cookie.name === "farm_locale");
    expect(localeCookie?.value).toBe("ar");

    await page.goto("/");
    await expect(page).toHaveURL(/\/ar$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(browserErrors).toEqual([]);
  });
});
