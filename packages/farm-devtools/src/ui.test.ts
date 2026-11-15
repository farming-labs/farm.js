import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { codeBlock, createShortcutMatcher, escapeHtml } from "./ui.js";
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
  it("matches only the configured toggle shortcut so other keys stay in the panel", () => {
    const key = (key: string, code: string, modifiers: Record<string, boolean> = {}) => ({
      key,
      code,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      ...modifiers,
    });
    const mac = createShortcutMatcher("mod+shift+.", true);
    expect(mac(key(">", "Period", { metaKey: true, shiftKey: true }))).toBe(true);
    expect(mac(key(">", "Period", { metaKey: true, shiftKey: true, repeat: true }))).toBe(false);
    expect(mac(key(">", "Period", { ctrlKey: true, shiftKey: true }))).toBe(false);
    for (const typed of ["a", "s", "Enter", "1"])
      expect(mac(key(typed, `Key${typed}`))).toBe(false);
    const other = createShortcutMatcher("Ctrl + D", false);
    expect(other(key("d", "KeyD", { ctrlKey: true }))).toBe(true);
    expect(other(key("d", "KeyD"))).toBe(false);
    expect(createShortcutMatcher("", false)(key("d", "KeyD"))).toBe(false);
  });
});
