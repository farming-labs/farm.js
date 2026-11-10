import { expect } from "vitest";
import type { FarmMarkdownRouteInput } from "../markdown";

export const literalRouteExposure: FarmMarkdownRouteInput[] = [
  ...Array.from({ length: 100 }, (_, index) => `/not-exposed-${index}`),
  "/",
  { route: "/target", cache: 60 },
  { route: "/docs/[slug]", cache: 30 },
];

export const literalRouteFiles = {
  "src/app/target/page.tsx": `import React from "react";
export default function Page() { return <main><h1>Target</h1><p>target-body.</p></main>; }`,
  "src/app/docs/[slug]/page.tsx": `import React from "react";
export default function Page() { return <main><h1>Dynamic</h1><p>dynamic-body.</p></main>; }`,
  "src/app/unexposed/page.tsx": `import React from "react";
export default function Page() { return <main><p>unexposed-page-html</p></main>; }`,
};

export async function verifyLiteralRouteExposure(origin: string): Promise<void> {
  for (const [pathname, title, body] of [
    ["/target", "Target", "target-body"],
    ["/docs/install", "Dynamic", "dynamic-body"],
  ] as const) {
    for (const suffix of [".md", ""]) {
      const url = `${origin}${pathname}${suffix}`;
      const response = await fetch(url, { headers: { accept: "text/markdown" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/markdown");
      // The SSR page's privacy policy must win over the exposed route's cache option.
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).toBe(`# ${title}\n\n${body}.\n`);
      const etag = response.headers.get("etag")!;
      expect(etag).toBeTruthy();
      const head = await fetch(url, { method: "HEAD", headers: { accept: "text/markdown" } });
      expect(head.status).toBe(200);
      expect(head.headers.get("etag")).toBe(etag);
      expect(await head.text()).toBe("");
      const cached = await fetch(url, {
        headers: { accept: "text/markdown", "if-none-match": etag },
      });
      expect(cached.status).toBe(304);
      expect(await cached.text()).toBe("");
    }
  }
  const deniedMirror = await fetch(`${origin}/unexposed.md`);
  expect(deniedMirror.status).toBe(404);
  expect(await deniedMirror.text()).not.toContain("unexposed-page-html");
  const ordinaryHtml = await fetch(`${origin}/unexposed`, { headers: { accept: "text/markdown" } });
  expect(ordinaryHtml.status).toBe(200);
  expect(ordinaryHtml.headers.get("content-type")).toContain("text/html");
  expect(await ordinaryHtml.text()).toContain("unexposed-page-html");
}
