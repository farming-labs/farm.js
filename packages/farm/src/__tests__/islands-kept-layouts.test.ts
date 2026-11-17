import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canFarmSkipKeptLayoutRender, explainFarmKeptLayoutRender } from "../islands-kept-layouts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "farm-kept-layouts-"));
  roots.push(root);
  for (const [file, source] of Object.entries(files)) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return root;
}

const layout = (body: string, imports = "") =>
  `${imports}\nimport type { ReactNode } from "react";\nexport default function Layout({ children }: { children: ReactNode }) {\n${body}\n}\n`;

const pureSidebar = {
  "src/components/sidebar.tsx": [
    '"use client";',
    'import { useState } from "react";',
    'import { Link } from "@farm.js/core/client";',
    'import "./sidebar.css";',
    "export function Sidebar({ items }: { items: string[] }) {",
    "  const [open, setOpen] = useState(false);",
    "  return <nav onClick={() => setOpen(!open)}>{items.map((item) => <Link key={item} href={item}>{item}</Link>)}</nav>;",
    "}",
  ].join("\n"),
  "src/components/sidebar.css": "nav { display: block; }",
  "src/data.ts": 'export const items = ["/a", "/b"].map((item) => item.toUpperCase());\n',
};

describe("kept layouts that cannot decide a request (RFC 0007)", () => {
  it("skips a layout that renders constants and client components", () => {
    const root = project({
      ...pureSidebar,
      "src/app/docs/layout.tsx": layout(
        "  return <div><Sidebar items={items} />{children}</div>;",
        'import { Sidebar } from "../../components/sidebar";\nimport { items } from "../../data";',
      ),
    });
    expect(explainFarmKeptLayoutRender("src/app/docs/layout.tsx", root)).toBeNull();
    expect(canFarmSkipKeptLayoutRender("src/app/docs/layout.tsx", root)).toBe(true);
  });

  it.each([
    [
      "a throw",
      'if (!children) throw new Error("no");\n  return children;',
      "",
      "a throw statement",
    ],
    ["an async layout", "return children;", "", "an async function", true],
    [
      "a use() call",
      "use(Promise.resolve());\n  return children;",
      'import { use } from "react";',
      "a use() call",
    ],
    ["Date", "return <p>{Date.now()}{children}</p>;", "", "the global Date"],
    ["process", "return <p>{process.env.X}{children}</p>;", "", "the global process"],
    ["Math.random()", "return <p>{Math.random()}{children}</p>;", "", "Math.random()"],
    ["fetch", "void fetch;\n  return children;", "", "the global fetch"],
    [
      "notFound from core",
      "return children;",
      'import { notFound } from "@farm.js/core";',
      "imports @farm.js/core",
    ],
    [
      "a request API",
      "return children;",
      'import { cookies } from "@farm.js/core/headers";',
      "imports @farm.js/core/headers",
    ],
    [
      "an unknown package",
      "return children;",
      'import { auth } from "auth-sdk";',
      "imports auth-sdk",
    ],
    [
      "a non-Link export of the client entry",
      "return children;",
      'import { useRouter } from "@farm.js/core/client";',
      "imports useRouter from @farm.js/core/client",
    ],
  ])("renders a layout with %s", (_name, body, imports, reason, isAsync = false) => {
    const source = layout(body, imports);
    const root = project({
      "src/app/layout.tsx": isAsync
        ? source.replace("export default function", "export default async function")
        : source,
    });
    expect(explainFarmKeptLayoutRender("src/app/layout.tsx", root)).toContain(reason);
    expect(canFarmSkipKeptLayoutRender("src/app/layout.tsx", root)).toBe(false);
  });

  it("follows imports: a guard two modules away keeps the layout rendering", () => {
    const root = project({
      "src/app/layout.tsx": layout(
        "return <Shell>{children}</Shell>;",
        'import { Shell } from "../shell";',
      ),
      "src/shell.tsx":
        'import { requireUser } from "./auth";\nexport function Shell({ children }: { children: unknown }) {\n  requireUser();\n  return children;\n}\n',
      "src/auth.ts": 'export function requireUser() {\n  throw new Error("signed out");\n}\n',
    });
    expect(explainFarmKeptLayoutRender("src/app/layout.tsx", root)).toBe(
      `${path.join("src", "auth.ts")} has a throw statement`,
    );
  });

  it("keeps rendering a layout with a top-level side effect or an unresolved import", () => {
    const effect = project({
      "src/app/layout.tsx": layout("return children;", 'console.log("loaded");'),
    });
    expect(explainFarmKeptLayoutRender("src/app/layout.tsx", effect)).toContain("top-level");
    const missing = project({
      "src/app/layout.tsx": layout("return children;", 'import { x } from "./missing";'),
    });
    expect(explainFarmKeptLayoutRender("src/app/layout.tsx", missing)).toContain(
      "imports ./missing",
    );
  });

  it("asks again after an edit to any module the answer read", () => {
    const root = project({
      ...pureSidebar,
      "src/app/layout.tsx": layout(
        "return <div><Sidebar items={items} />{children}</div>;",
        'import { Sidebar } from "../components/sidebar";\nimport { items } from "../data";',
      ),
    });
    expect(canFarmSkipKeptLayoutRender("src/app/layout.tsx", root)).toBe(true);
    // A different size changes the stamp even within one mtime tick.
    writeFileSync(
      path.join(root, "src/data.ts"),
      'export const items: string[] = [];\nif (Math.random()) throw new Error("x");\n',
    );
    expect(canFarmSkipKeptLayoutRender("src/app/layout.tsx", root)).toBe(false);
  });
});
