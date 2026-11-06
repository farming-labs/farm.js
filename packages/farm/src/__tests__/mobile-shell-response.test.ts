// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  _applyFarmMobileShellClient,
  createFarmMobileShellRewriter,
  isFarmMobileShellRequest,
  type FarmMobileShellClient,
} from "../mobile/shell-response";

const CLIENT: FarmMobileShellClient = {
  webEntry: "/farm-client-h11111111.js",
  entry: "/farm-mobile-client-h22222222.js",
  webOnly: ["chunks/page-h33333333.js"],
};

const DOCUMENT = [
  "<!DOCTYPE html><html><head>",
  '  <link rel="stylesheet" href="/assets/farm-client-h44444444.css">',
  '  <link rel="modulepreload" href="/chunks/react-h55555555.js" fetchpriority="low">',
  '  <link rel="modulepreload" href="/chunks/page-h33333333.js" fetchpriority="low">',
  '  <link rel="modulepreload" href="/farm-client-h11111111.js">',
  "</head><body><main>hello</main>",
  '  <script type="module" src="/farm-client-h11111111.js"></script>',
  "</body></html>",
].join("\n");

function htmlResponse(body: string, headers: Record<string, string> = {}): Response {
  const chunks = body.match(/[\s\S]{1,7}/g) ?? [];
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        // Small chunks, so tags and URLs straddle chunk boundaries.
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(body.length),
        "cache-control": "public, max-age=0, s-maxage=60",
        "cdn-cache-control": "max-age=60",
        etag: '"abc"',
        ...headers,
      },
    },
  );
}

function shellRequest(os = "android"): Request {
  return new Request("https://notes.example.com/notes", { headers: { "X-Farm-Shell": os } });
}

describe("the mobile shell response", () => {
  it("recognizes the header a shell adds, and nothing else", () => {
    expect(isFarmMobileShellRequest(shellRequest("android"))).toBe(true);
    expect(isFarmMobileShellRequest(shellRequest("ios"))).toBe(true);
    expect(isFarmMobileShellRequest(new Request("https://notes.example.com/"))).toBe(false);
    for (const value of ["", "Android", "a b", "x".repeat(40), "<script>"]) {
      expect(isFarmMobileShellRequest(shellRequest(value))).toBe(false);
    }
  });

  it("points a shell's document at the mobile client across chunk boundaries", async () => {
    const response = _applyFarmMobileShellClient(shellRequest(), htmlResponse(DOCUMENT), CLIENT);
    const html = await response.text();
    expect(html).toContain('<script type="module" src="/farm-mobile-client-h22222222.js">');
    expect(html).toContain('<link rel="modulepreload" href="/farm-mobile-client-h22222222.js">');
    expect(html).not.toContain("farm-client-h11111111");
    // The web-only page chunk is not preloaded; the chunk both clients share still is.
    expect(html).not.toContain("page-h33333333");
    expect(html).toContain("/chunks/react-h55555555.js");
    // Both clients use the same stylesheet.
    expect(html).toContain("/assets/farm-client-h44444444.css");
    expect(html).toContain("<main>hello</main>");
  });

  it("keeps a shell's document out of shared caches and varies every document on the header", async () => {
    const shell = _applyFarmMobileShellClient(shellRequest(), htmlResponse(DOCUMENT), CLIENT);
    expect(shell.headers.get("cache-control")).toBe("private, no-store");
    expect(shell.headers.get("cdn-cache-control")).toBeNull();
    expect(shell.headers.get("vary")).toBe("X-Farm-Shell");
    expect(shell.headers.get("content-length")).toBeNull();
    expect(shell.headers.get("etag")).toBeNull();

    const web = _applyFarmMobileShellClient(
      new Request("https://notes.example.com/notes"),
      htmlResponse(DOCUMENT, { vary: "Accept-Encoding" }),
      CLIENT,
    );
    expect(web.headers.get("vary")).toBe("Accept-Encoding, X-Farm-Shell");
    expect(web.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60");
    expect(await web.text()).toBe(DOCUMENT);
  });

  it("tells the adapter a shell's document is private", async () => {
    let calls = 0;
    _applyFarmMobileShellClient(shellRequest("ios"), htmlResponse(DOCUMENT), CLIENT, () => calls++);
    _applyFarmMobileShellClient(
      new Request("https://notes.example.com/"),
      htmlResponse(DOCUMENT),
      CLIENT,
      () => calls++,
    );
    expect(calls).toBe(1);
  });

  it("leaves anything but HTML alone, and every response of an app without a mobile client", async () => {
    const json = Response.json({ entry: "/farm-client-h11111111.js" });
    expect(_applyFarmMobileShellClient(shellRequest(), json, CLIENT)).toBe(json);
    const html = htmlResponse(DOCUMENT);
    expect(_applyFarmMobileShellClient(shellRequest(), html, null)).toBe(html);
  });

  it("passes an unfinished tag through once it is longer than any tag Farm writes", () => {
    const rewrite = createFarmMobileShellRewriter(CLIENT);
    const long = `<div data-x="${"a".repeat(5000)}`;
    expect(rewrite(long)).toBe(long);
    expect(rewrite('"><script src="/farm-client-h11111111.js"></script>', true)).toBe(
      '"><script src="/farm-mobile-client-h22222222.js"></script>',
    );
  });
});
