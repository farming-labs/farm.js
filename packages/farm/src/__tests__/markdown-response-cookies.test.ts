// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMarkdownMirrorResponse, resolveMarkdownConfig } from "../markdown";

const cookies = [
  "session=renewed; Path=/; Secure; HttpOnly; SameSite=Lax",
  "session=scoped; Path=/account; Secure; HttpOnly",
  "old=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
];

function pageResponse(status = 200) {
  const headers = new Headers({
    "content-type": status === 200 ? "text/html" : "text/plain",
    "cache-control": "public, max-age=300",
  });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  if (status >= 300 && status < 400) headers.set("location", "/login");
  if (status === 401) headers.set("www-authenticate", 'Bearer realm="account"');
  return new Response("<main><h1>Account</h1><p>Welcome</p></main>", { status, headers });
}

const mirror = (request: Request, page = pageResponse()) =>
  createMarkdownMirrorResponse({
    request,
    config: resolveMarkdownConfig({ cache: 300 }),
    renderPage: () => page,
  });

describe("Markdown response cookies", () => {
  it.each(["GET", "HEAD"])(
    "preserves every cookie in %s mirrors and negotiated responses",
    async (method) => {
      for (const pathname of ["/account.md", "/account"]) {
        const page = pageResponse();
        const response = await mirror(
          new Request(`https://farm.test${pathname}`, {
            method,
            headers: { accept: "text/markdown" },
          }),
          page,
        );
        expect(response?.status).toBe(200);
        expect(response?.headers.getSetCookie()).toEqual(cookies);
        expect(response?.headers.get("cache-control")).toBe("private, no-store");
        expect(response?.headers.get("content-type")).toContain("text/markdown");
        expect(page.headers.getSetCookie()).toEqual(cookies);
        expect(page.headers.get("cache-control")).toBe("public, max-age=300");
        if (method === "HEAD") expect(await response?.text()).toBe("");
      }
    },
  );

  it.each(["?outline", "?section=account", "?actions", "?max_tokens=100", "?section=missing"])(
    "preserves cookies when selecting a view (%s)",
    async (query) => {
      const response = await mirror(new Request(`https://farm.test/account.md${query}`));
      expect(response?.headers.getSetCookie()).toEqual(cookies);
      expect(response?.headers.get("cache-control")).toBe("private, no-store");
    },
  );

  it("preserves cookies on a conditional 304 without returning a body", async () => {
    const response = await mirror(new Request("https://farm.test/account.md"));
    const conditional = await mirror(
      new Request("https://farm.test/account.md", {
        headers: { "if-none-match": response!.headers.get("etag")! },
      }),
    );
    expect(conditional?.status).toBe(304);
    expect(conditional?.headers.getSetCookie()).toEqual(cookies);
    expect(conditional?.headers.get("cache-control")).toBe("private, no-store");
    expect(await conditional?.text()).toBe("");
  });

  it.each([302, 307, 401, 403])("preserves cookies on an access response (%s)", async (status) => {
    for (const method of ["GET", "HEAD"]) {
      const response = await mirror(
        new Request("https://farm.test/account.md", { method }),
        pageResponse(status),
      );
      expect(response?.status).toBe(status);
      expect(response?.headers.getSetCookie()).toEqual(cookies);
      expect(response?.headers.get("cache-control")).toContain("no-store");
      if (status < 400) expect(response?.headers.get("location")).toBe("/login");
      if (status === 401)
        expect(response?.headers.get("www-authenticate")).toBe('Bearer realm="account"');
      if (method === "HEAD") expect(await response?.text()).toBe("");
    }
  });

  it("keeps a cookie when the Headers implementation lacks getSetCookie", async () => {
    const page = pageResponse();
    page.headers.delete("set-cookie");
    page.headers.set("set-cookie", cookies[2]);
    Object.defineProperty(page.headers, "getSetCookie", { value: undefined });
    const response = await mirror(new Request("https://farm.test/account.md"), page);
    expect(response?.headers.getSetCookie()).toEqual([cookies[2]]);
  });

  it("keeps configured caching for pages that do not set cookies", async () => {
    const page = pageResponse();
    page.headers.delete("set-cookie");
    const response = await mirror(new Request("https://farm.test/account.md"), page);
    expect(response?.headers.getSetCookie()).toEqual([]);
    expect(response?.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
  });

  it("does not render or change ordinary requests or disabled mirrors", async () => {
    const renderPage = vi.fn(pageResponse);
    for (const [url, enabled] of [
      ["https://farm.test/account", true],
      ["https://farm.test/account.md", false],
    ] as const) {
      expect(
        await createMarkdownMirrorResponse({
          request: new Request(url),
          config: resolveMarkdownConfig(enabled),
          renderPage,
        }),
      ).toBeNull();
    }
    expect(renderPage).not.toHaveBeenCalled();
  });
});
