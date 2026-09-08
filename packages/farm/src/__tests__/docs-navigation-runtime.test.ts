/** @vitest-environment node */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { resolveDocsConfig } from "../config";
import { createFarmDocsHandler } from "../docs";

describe("docs client navigation", () => {
  it("reconciles route metadata when a soft navigation replaces the page", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-navigation-"));
    const docsDir = path.join(root, "src", "app", "docs");

    try {
      await fs.mkdir(path.join(docsDir, "guide"), { recursive: true });
      await fs.writeFile(
        path.join(docsDir, "page.md"),
        "---\ntitle: Home\ndescription: Home description\n---\n\n# Home\n\n[Guide](/docs/guide)",
      );
      await fs.writeFile(path.join(docsDir, "guide", "page.md"), "# Guide\n\nGuide content.");
      const docs = await resolveDocsConfig({ entry: "/docs" }, { root, srcDir: "src" });
      const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });
      const currentResponse = await handler(new Request("http://farm.test/docs"));
      const nextResponse = await handler(new Request("http://farm.test/docs/guide"));
      const dom = new JSDOM(await currentResponse!.text(), {
        url: "http://farm.test/docs",
        runScripts: "outside-only",
        pretendToBeVisual: true,
      });

      try {
        const nextHTML = await nextResponse!.text();
        dom.window.scrollTo = vi.fn();
        dom.window.fetch = vi.fn(async () =>
          Promise.resolve(
            new Response(nextHTML, {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }),
          ),
        ) as typeof dom.window.fetch;
        const runtime = Array.from(dom.window.document.scripts).find((script) =>
          script.textContent.includes("__farmDocsRuntime"),
        )?.textContent;
        expect(runtime).toBeTruthy();
        dom.window.eval(runtime!);
        dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

        const guideLink =
          dom.window.document.querySelector<HTMLAnchorElement>('a[href="/docs/guide"]');
        expect(guideLink).toBeTruthy();
        guideLink!.dispatchEvent(
          new dom.window.MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
        );

        await vi.waitFor(() => expect(dom.window.document.title).toBe("Guide"));
        expect(dom.window.document.querySelector('meta[name="description"]')).toBeNull();
      } finally {
        dom.window.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
