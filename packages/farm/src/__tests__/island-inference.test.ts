// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inferFarmIslandStrategy } from "../island-inference";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-island-inference-"));
let count = 0;

/** Writes `files` (name → source) into a fresh app directory; returns the first file's path. */
function app(files: Record<string, string>): string {
  const dir = path.join(root, `app-${count++}`, "src");
  for (const [name, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), source);
  }
  return path.join(dir, Object.keys(files)[0]!);
}

function infer(files: Record<string, string>) {
  const file = app(files);
  return inferFarmIslandStrategy(file, path.dirname(path.dirname(file)));
}

const client = (body: string) => `"use client";\nimport { useState } from "react";\n${body}`;

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("inferFarmIslandStrategy", () => {
  it("lets an island that only changes state on a click wait for one", () => {
    const result = infer({
      "like.tsx": client(`export function Like() {
        const [likes, setLikes] = useState(0);
        return <button type="button" onClick={() => setLikes(likes + 1)}>{likes}</button>;
      }`),
    });
    expect(result.strategy).toBe("interaction");
    expect(result.files).toHaveLength(1);
  });

  it("allows browser APIs inside handlers and same-page links it handles", () => {
    const result = infer({
      "toc.tsx": client(`export function Toc({ ids }: { ids: string[] }) {
        const [active, setActive] = useState(ids[0]);
        return <ol>{ids.map((id) => (
          <li key={id} data-active={id === active ? "" : undefined}>
            <a href={\`#\${id}\`} onClick={() => { setActive(id); navigator.clipboard?.writeText(id); }}>{id}</a>
          </li>))}</ol>;
      }`),
    });
    expect(result.strategy).toBe("interaction");
  });

  it("follows the app's own imports, and keeps load for what they do", () => {
    const passing = infer({
      "menu.tsx": client(
        `import { Item } from "./item";\nexport function Menu() { return <ul><Item /></ul>; }`,
      ),
      "item.tsx": `export function Item() { return <li><a href="/docs">Docs</a></li>; }`,
    });
    expect(passing.strategy).toBe("interaction");
    expect(passing.files).toHaveLength(2);

    const failing = infer({
      "menu.tsx": client(
        `import { useWidth } from "./width";\nexport function Menu() { return <p>{useWidth()}</p>; }`,
      ),
      "width.ts": `import { useEffect, useState } from "react";\nexport function useWidth() { const [w, setW] = useState(0); useEffect(() => setW(1), []); return w; }`,
    });
    expect(failing.strategy).toBeNull();
    expect(failing.reason).toContain("width.ts: calls useEffect");
  });

  it.each([
    [
      "an effect",
      `export function A() { useEffect(() => {}, []); return null; }`,
      "calls useEffect",
    ],
    [
      "React.useLayoutEffect",
      `import * as React from "react";\nexport function A() { React.useLayoutEffect(() => {}); return null; }`,
      "calls useLayoutEffect",
    ],
    [
      "an external store",
      `export function A() { useSyncExternalStore(() => () => {}, () => 1); return null; }`,
      "calls useSyncExternalStore",
    ],
    [
      "a ref",
      `export function A() { return <div ref={(node) => node?.focus()} />; }`,
      "sets a ref on <div>",
    ],
    [
      "autoFocus",
      `export function A() { return <button autoFocus>Go</button>; }`,
      "sets autoFocus",
    ],
    [
      "a hover handler",
      `export function A() { return <div onMouseEnter={() => {}} />; }`,
      "handles onMouseEnter",
    ],
    [
      "a key handler",
      `export function A() { return <div onKeyDown={() => {}} />; }`,
      "handles onKeyDown",
    ],
    ["a field", `export function A() { return <input name="q" />; }`, "renders <input>"],
    [
      "props spread onto an element",
      `export function A(props: object) { return <button {...props} />; }`,
      "spreads props onto <button>",
    ],
    [
      "a click on a link to another page",
      `export function A() { return <a href="/next" onClick={() => {}}>Next</a>; }`,
      "handles a click on a link",
    ],
    ["a class component", `export class A { render() { return null; } }`, "declares a class"],
    [
      "code that runs as the module loads",
      `window.addEventListener("resize", () => {});\nexport function A() { return null; }`,
      "runs code as it loads",
    ],
    [
      "a top-level call",
      `const width = window.innerWidth.toString();\nexport function A() { return <p>{width}</p>; }`,
      "runs code as it loads",
    ],
    [
      "a package import",
      `import { motion } from "motion/react";\nexport function A() { return <motion.div />; }`,
      "imports motion/react",
    ],
    [
      "createElement",
      `import { createElement } from "react";\nexport function A() { return createElement("button"); }`,
      "calls createElement",
    ],
    [
      "a runtime import",
      `export function A() { void import("./b"); return null; }`,
      "imports a module at runtime",
    ],
  ])("keeps load for %s", (_name, body, reason) => {
    const result = infer({ "a.tsx": client(body) });
    expect(result.strategy).toBeNull();
    expect(result.reason).toContain(reason);
  });

  it("allows document.createElement in a handler, context, and memo", () => {
    const result = infer({
      "copy.tsx": client(`import { createContext, memo, useContext } from "react";
        const Theme = createContext("light");
        export const Copy = memo(function Copy({ text }: { text: string }) {
          const theme = useContext(Theme);
          return <button className={theme} onClick={() => { const area = document.createElement("textarea"); area.value = text; }}>Copy</button>;
        });`),
    });
    expect(result.strategy).toBe("interaction");
  });

  it("ignores type-only and stylesheet imports", () => {
    const result = infer({
      "nav.tsx": client(
        `import type { Section } from "@acme/types";\nimport "./nav.css";\nexport function Nav({ s }: { s: Section }) { return <nav>{String(s)}</nav>; }`,
      ),
      "nav.css": "nav { color: red }",
    });
    expect(result.strategy).toBe("interaction");
  });

  it("sees a change to a file it already read", () => {
    const file = app({
      "a.tsx": client(`export function A() { return <button onClick={() => {}}>A</button>; }`),
    });
    const appRoot = path.dirname(path.dirname(file));
    expect(inferFarmIslandStrategy(file, appRoot).strategy).toBe("interaction");
    fs.writeFileSync(file, client(`export function A() { useEffect(() => {}); return null; }`));
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(file, future, future);
    expect(inferFarmIslandStrategy(file, appRoot).strategy).toBeNull();
  });
});
