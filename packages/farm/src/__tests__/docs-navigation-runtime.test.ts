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

  it("copies code through the CSP-compatible runtime and preserves the clipboard fallback", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-code-copy-"));
    const docsDir = path.join(root, "src", "app", "docs");

    try {
      await fs.mkdir(docsDir, { recursive: true });
      await fs.writeFile(
        path.join(docsDir, "page.md"),
        [
          "# Copy",
          "",
          "```ts",
          "const first = 1;",
          "```",
          "",
          "```ts",
          "const second = 2;",
          "```",
        ].join("\n"),
      );
      const docs = await resolveDocsConfig({ entry: "/docs" }, { root, srcDir: "src" });
      const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });
      const response = await handler(new Request("http://farm.test/docs"));
      const dom = new JSDOM(await response!.text(), {
        url: "http://farm.test/docs",
        runScripts: "outside-only",
      });

      try {
        const buttons = Array.from(
          dom.window.document.querySelectorAll<HTMLButtonElement>("[data-code-copy]"),
        );
        const codeBlocks = Array.from(dom.window.document.querySelectorAll<HTMLElement>("code"));
        expect(buttons).toHaveLength(2);
        expect(codeBlocks).toHaveLength(2);
        Object.defineProperty(codeBlocks[0], "innerText", {
          configurable: true,
          value: "const first = 1;",
        });
        Object.defineProperty(codeBlocks[1], "innerText", {
          configurable: true,
          value: "const second = 2;",
        });

        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(dom.window.navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });
        const resetCallbacks: Array<() => void> = [];
        dom.window.setTimeout = vi.fn((callback: TimerHandler) => {
          resetCallbacks.push(callback as () => void);
          return resetCallbacks.length;
        }) as typeof dom.window.setTimeout;
        dom.window.clearTimeout = vi.fn();

        const runtime = Array.from(dom.window.document.scripts).find((script) =>
          script.textContent.includes("__farmDocsPageActionsRuntime"),
        )?.textContent;
        expect(runtime).toBeTruthy();
        dom.window.eval(runtime!);

        buttons[0]!.click();
        await vi.waitFor(() => {
          expect(writeText).toHaveBeenCalledWith("const first = 1;");
          expect(buttons[0]!.dataset.copied).toBe("true");
        });
        expect(buttons[0]!.getAttribute("aria-label")).toBe("Copied");
        expect(buttons[0]!.title).toBe("Copied");

        buttons[0]!.click();
        await vi.waitFor(() => {
          expect(writeText).toHaveBeenCalledTimes(2);
          expect(dom.window.clearTimeout).toHaveBeenCalledWith(1);
        });
        resetCallbacks.at(-1)!();
        expect(buttons[0]!.dataset.copied).toBe("false");
        expect(buttons[0]!.getAttribute("aria-label")).toBe("Copy code");
        expect(buttons[0]!.title).toBe("Copy code");

        writeText.mockRejectedValueOnce(new Error("clipboard permission denied"));
        let fallbackValue = "";
        const execCommand = vi.fn(() => {
          fallbackValue =
            dom.window.document.querySelector<HTMLTextAreaElement>("textarea")?.value || "";
          return true;
        });
        Object.defineProperty(dom.window.document, "execCommand", {
          configurable: true,
          value: execCommand,
        });

        buttons[1]!.click();
        await vi.waitFor(() => {
          expect(execCommand).toHaveBeenCalledWith("copy");
          expect(buttons[1]!.dataset.copied).toBe("true");
        });
        expect(fallbackValue).toBe("const second = 2;");
        expect(dom.window.document.querySelector("textarea")).toBeNull();
      } finally {
        dom.window.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
