import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { codeBlock, escapeHtml } from "./ui.js";
import { startDevtoolsLauncher } from "./client.js";

describe("DevTools code and launcher", () => {
  it("highlights TypeScript/JSX and JSON without executing or interpreting their markup", () => {
    for (const source of [
      "export const value: number = 1;",
      '{"secret": false}',
      `const text = '<img src=x onerror=alert(1)>';\n// </code><script>alert(1)</script>`,
    ]) {
      const dom = new JSDOM(codeBlock(source, "Source", "source"));
      expect(dom.window.document.querySelector("pre code")?.textContent).toBe(source);
      expect(dom.window.document.querySelectorAll("pre span").length).toBeGreaterThan(0);
      expect(dom.window.document.querySelectorAll("script,img")).toHaveLength(0);
      dom.window.close();
    }
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });
  it("bounds the visual code block and clearly labels truncation", () => {
    const dom = new JSDOM(
      codeBlock(
        Array.from({ length: 1501 }, (_, i) => `const line${i} = ${i};`).join("\n"),
        "Source",
        "source",
      ),
    );
    expect(dom.window.document.querySelector("pre")?.textContent).not.toContain("line1500");
    expect(dom.window.document.body.textContent).toContain("first 1,500 lines");
    dom.window.close();
  });
  it("uses the core opener and removes the launcher on disposal", () => {
    const dom = new JSDOM("<body></body>", { url: "http://localhost:3000" });
    let opens = 0;
    Object.assign(dom.window, {
      __FARM_DEVTOOLS__: {
        open() {
          opens++;
        },
      },
    });
    const runtime = startDevtoolsLauncher(dom.window as never);
    const host = dom.window.document.querySelector("farm-devtools-launcher")!;
    expect(host.shadowRoot!.querySelector("button span")?.textContent).toBe("DevTools");
    expect(host.shadowRoot!.querySelector("img")?.getAttribute("alt")).toBe("");
    host.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    expect(opens).toBe(1);
    runtime.dispose();
    expect(dom.window.document.querySelector("farm-devtools-launcher")).toBeNull();
    dom.window.close();
  });
  it("keeps only one launcher after reinitialization and tolerates a missing opener", () => {
    const dom = new JSDOM("<body></body>");
    const first = startDevtoolsLauncher(dom.window as never);
    const second = startDevtoolsLauncher(dom.window as never);
    expect(dom.window.document.querySelectorAll("farm-devtools-launcher")).toHaveLength(1);
    expect(() =>
      dom.window.document
        .querySelector("farm-devtools-launcher")!
        .shadowRoot!.querySelector("button")!
        .click(),
    ).not.toThrow();
    first.dispose();
    expect(dom.window.document.querySelectorAll("farm-devtools-launcher")).toHaveLength(1);
    second.dispose();
    dom.window.close();
  });
});
