// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FarmUserConfig } from "../config";
import { loadFarmMobileRuntime } from "../config-runtime";
import { CORE_PORTABLE } from "../mobile/analyzer";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const LAYOUT = "export default function Layout({ children }) { return children; }\n";

async function createApp(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-mobile-analyzer-"));
  roots.push(root);
  for (const [file, contents] of Object.entries({
    "package.json": JSON.stringify({ name: "notes" }),
    "src/app/layout.tsx": LAYOUT,
    ...files,
  })) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), contents);
  }
  return root;
}

function userConfig(native: object = {}, extra: Partial<FarmUserConfig> = {}): FarmUserConfig {
  return {
    telemetry: false,
    ...extra,
    mobile: { id: "com.example.notes", server: "https://notes.example.com", native },
  };
}

async function report(root: string, config: FarmUserConfig = userConfig()) {
  const { generateFarmMobileRoutes } = await loadFarmMobileRuntime();
  return generateFarmMobileRoutes({ root, userConfig: config, analyze: true });
}

function routeOf(result: Awaited<ReturnType<typeof report>>, route: string) {
  const entry = result.report!.routes.find((candidate) => candidate.route === route);
  if (!entry) throw new Error(`no report row for ${route}`);
  return entry;
}

const rules = (entry: ReturnType<typeof routeOf>) =>
  entry.analysis!.blockers.map(
    (blocker) =>
      `${blocker.file}:${blocker.line}:${blocker.column} ${blocker.rule} ${blocker.message}`,
  );

describe("mobile native analyzer", () => {
  it("ports a pure @farm.js/ui page and plain HTML that maps, and explains no-win pages", async () => {
    const root = await createApp({
      "src/app/page.tsx": `import { List, Text, View } from "@farm.js/ui";
const posts = [{ id: 1, title: "Hello" }];
export default function Feed() {
  return (
    <View padding="md">
      <Text>Feed</Text>
      <List items={posts} row={(post) => ({ title: post.title, href: "/posts/" + post.id })} />
      {posts.map((post) => <Text key={post.id}>{post.title}</Text>)}
    </View>
  );
}
`,
      "src/app/notes/page.tsx": `"use client";
import { useState } from "react";
import { Link } from "@farm.js/core/client";
export default function Notes() {
  const [query, setQuery] = useState("");
  const notes = ["a", "b"];
  return (
    <main className="flex flex-col gap-4 p-4 dark:bg-gray-900">
      <h1 className="text-2xl font-bold text-gray-900">Notes</h1>
      <input type="search" value={query} placeholder="Search" onChange={(event) => setQuery(event.target.value)} />
      <ul>
        {notes.map((note) => (
          <li key={note} style={{ paddingTop: 4, color: "#333" }}>
            <Link href={"/notes/" + note}>{note}</Link>
          </li>
        ))}
      </ul>
      <img src="/logo.png" alt="Logo" />
      <button onClick={() => setQuery("")}>Clear</button>
    </main>
  );
}
`,
      "src/app/about/page.tsx": `export default function About() {
  return <article><h1>About</h1><p>Static text.</p></article>;
}
`,
    });
    const result = await report(root);
    const feed = routeOf(result, "/");
    expect(feed).toMatchObject({ screen: "web", source: "default" });
    expect(feed.analysis).toMatchObject({
      decision: "port",
      portable: true,
      blockers: [],
      wins: ["list"],
      portablePercent: 100,
      modules: 2,
    });
    expect(feed.analysis!.elements).toEqual({
      total: 4,
      mapped: 4,
      byKind: { View: 1, Text: 2, List: 1 },
    });
    expect(feed.analysis!.ir!.root).toBe("src/app/page.tsx#default");
    expect(feed.analysis!.ir!.components["src/app/page.tsx#default"]).toMatchObject({
      kind: "View",
      tag: "View",
      props: { padding: "md" },
    });
    expect(feed.analysis!.irBytes).toBe(Buffer.byteLength(JSON.stringify(feed.analysis!.ir)));

    const notes = routeOf(result, "/notes");
    expect(notes.analysis).toMatchObject({
      decision: "port",
      portable: true,
      wins: ["input", "list"],
    });
    expect(notes.analysis!.elements.byKind).toEqual({
      View: 2,
      Text: 1,
      TextInput: 1,
      List: 1,
      Pressable: 2,
      Image: 1,
    });
    const main = notes.analysis!.ir!.components["src/app/notes/page.tsx#default"]!;
    expect(main).toMatchObject({
      kind: "View",
      tag: "main",
      style: ["flex", "flex-col", "gap-4", "p-4", "dark:bg-gray-900"],
    });
    expect(main.children![1]).toMatchObject({
      kind: "TextInput",
      props: { type: "search", placeholder: "Search", value: "{expr}" },
      events: ["onChange"],
    });

    expect(routeOf(result, "/about").analysis).toMatchObject({
      decision: "web",
      portable: true,
      wins: [],
    });
    expect(result.table).toMatch(
      /\/about\s+web\s+web\s+3\/3\s+100%\s+portable; no win \(3 elements\)/,
    );
    expect(result.table).toMatch(/\/notes\s+web\s+port\s+8\/8\s+100%\s+portable; input, list/);
    // Report only: every route stays a web screen.
    expect(result.manifest.rules.every((rule) => rule.screen === "web")).toBe(true);
    const written = JSON.parse(await fs.readFile(result.reportFile!, "utf8"));
    expect(written).toEqual(JSON.parse(JSON.stringify(result.report)));
    expect(written.summary).toEqual({
      routes: 3,
      analyzed: 3,
      port: 2,
      portableNoWin: 1,
      blocked: 0,
      native: 0,
    });
  });

  it("names every blocker with file, line, column, and rule", async () => {
    const root = await createApp({
      "src/app/chart/page.tsx": `export default function Chart() {
  return (
    <div>
      <canvas width={300} />
      <table><tbody><tr><td>1</td></tr></tbody></table>
      <div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />
      <div className="grid grid-cols-2 md:flex hover:bg-gray-100 shadow-lg w-[37px] card" />
      <div className={"p-" + 4} style={{ display: "grid", transform: "none", width: "calc(100% - 4px)" }} />
      <div onScroll={() => {}} onClick={() => {}} />
    </div>
  );
}
`,
      "src/app/pkg/page.tsx": `import confetti from "canvas-confetti";
import { createPortal } from "react-dom";
import { cookies } from "@farm.js/core/headers";
import { Link } from "@farm.js/core/client";
export default function Pkg() { return <Link href="/">home</Link>; }
`,
      "src/app/calls/page.tsx": `import React from "react";
const Tag = "h1";
const Card = React.memo(function Card() { return <p>card</p>; });
export default function Calls() {
  return <div><Tag>title</Tag><Card />{React.createElement("canvas")}</div>;
}
`,
      "src/app/effect/page.tsx": `"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
export default function Effect({ icon: Icon }) {
  const ref = useRef(null);
  useEffect(() => {
    const width = window.innerWidth;
    localStorage.setItem("w", String(width));
  }, []);
  useLayoutEffect(() => {}, []);
  return <div ref={ref}><Icon /></div>;
}
`,
    });
    const result = await report(root);
    expect(rules(routeOf(result, "/chart"))).toEqual([
      "src/app/chart/page.tsx:4:7 unmapped-element <canvas> has no native mapping",
      "src/app/chart/page.tsx:5:7 unmapped-element <table> has no native mapping",
      "src/app/chart/page.tsx:5:14 unmapped-element <tbody> has no native mapping",
      "src/app/chart/page.tsx:5:21 unmapped-element <tr> has no native mapping",
      "src/app/chart/page.tsx:5:25 unmapped-element <td> has no native mapping",
      "src/app/chart/page.tsx:6:12 dangerously-set-inner-html dangerouslySetInnerHTML",
      'src/app/chart/page.tsx:7:12 class-name "grid" uses grid layout',
      'src/app/chart/page.tsx:7:12 class-name "grid-cols-2" uses grid layout',
      'src/app/chart/page.tsx:7:12 class-name "md:flex" is a media query',
      'src/app/chart/page.tsx:7:12 class-name "hover:bg-gray-100" needs the CSS hover: selector',
      'src/app/chart/page.tsx:7:12 class-name "shadow-lg" is a visual effect with no native mapping',
      'src/app/chart/page.tsx:7:12 class-name "w-[37px]" is an arbitrary value',
      'src/app/chart/page.tsx:7:12 class-name class "card" is not in the native Tailwind subset',
      "src/app/chart/page.tsx:8:12 runtime-class-name <div> builds its class names at runtime",
      'src/app/chart/page.tsx:8:42 style style.display "grid" has no native mapping',
      "src/app/chart/page.tsx:8:59 style style.transform has no native mapping",
      'src/app/chart/page.tsx:8:78 style style.width "calc(100% - 4px)" uses a CSS-only unit or function',
      "src/app/chart/page.tsx:9:12 dom-event onScroll on <div> has no native event",
    ]);
    const chart = routeOf(result, "/chart").analysis!;
    expect(chart).toMatchObject({ decision: "web", portable: false });
    expect(chart.elements).toMatchObject({ total: 10, mapped: 5 });
    expect(chart.portablePercent).toBe(50);
    expect(chart).not.toHaveProperty("ir");

    expect(rules(routeOf(result, "/pkg"))).toEqual([
      'src/app/pkg/page.tsx:1:1 unknown-package import "canvas-confetti" has no native mapping',
      'src/app/pkg/page.tsx:2:1 dom-package import "react-dom" renders to the DOM',
      'src/app/pkg/page.tsx:3:1 unmapped-import cookies from "@farm.js/core/headers" has no native mapping',
    ]);
    expect(rules(routeOf(result, "/calls"))).toEqual([
      "src/app/calls/page.tsx:5:15 dynamic-component <Tag> is a value the analyzer cannot resolve to a component",
      "src/app/calls/page.tsx:5:40 create-element createElement() builds elements the analyzer cannot check",
    ]);
    expect(rules(routeOf(result, "/effect"))).toEqual([
      "src/app/effect/page.tsx:6:19 browser-global window is a browser API",
      "src/app/effect/page.tsx:7:5 browser-global localStorage is a browser API",
      "src/app/effect/page.tsx:9:3 layout-effect useLayoutEffect reads layout from the DOM",
      "src/app/effect/page.tsx:10:15 dom-ref a ref on <div> reaches the DOM",
      "src/app/effect/page.tsx:10:25 dynamic-component <Icon> is a value the analyzer cannot resolve to a component",
    ]);
    expect(result.table).toMatch(
      /\/chart\s+web\s+web\s+5\/10\s+50%\s+src\/app\/chart\/page\.tsx:4:7 <canvas> has no native mapping \(\+17 more\)/,
    );
  });

  it("follows app modules once, stops at server functions, and checks layouts", async () => {
    const root = await createApp({
      "tsconfig.json": `{
  // comments are allowed
  "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["src/lib/*"] } },
}`,
      "src/app/layout.tsx": `import "./globals.css";\n${LAYOUT}`,
      "src/app/globals.css": "body { margin: 0 }",
      // A native layout replaces the web one on native screens.
      "src/app/(native)/layout.tsx": `import "../globals.css";\n${LAYOUT}`,
      "src/app/(native)/layout.native.tsx": LAYOUT,
      "src/app/layout.native.tsx": LAYOUT,
      "src/app/(native)/notes/[id]/page.tsx": `import { useSearchParams } from "@farm.js/core/navigation";
import { useServerQuery } from "@farm.js/core/server-query/client";
import { Card } from "@/components/card";
import { getNote } from "~/notes";
export default function Note() {
  const id = useSearchParams().get("id") ?? "";
  const { data } = useServerQuery(getNote, { id });
  return <Card title={data?.title ?? id} />;
}
`,
      "src/app/(native)/drafts/page.tsx": `import { Card } from "@/components/card";
import { Widget } from "../../../components/widget";
export default function Drafts() { return <section><Card title="x" /><Widget /></section>; }
`,
      "src/app/web/page.tsx": `export default function Web() { return <div className="flex" />; }\n`,
      "src/components/card.tsx": `import type { ReactNode } from "react";
export function Card({ title }: { title: ReactNode }) {
  return <div className="rounded-lg border p-4"><h2>{title}</h2></div>;
}
`,
      "src/components/widget.tsx": `export function Widget({ tone }: { tone: string }) {
  return <span className={\`text-\${tone}\`}>w</span>;
}
`,
      "src/lib/notes.ts": `import { readFile } from "node:fs/promises";
import { createServerFn } from "@farm.js/core/server-fn";
export const getNote = createServerFn({ handler: async ({ id }) => JSON.parse(await readFile(id, "utf8")) });
`,
    });
    const result = await report(root);
    const note = routeOf(result, "/notes/[id]").analysis!;
    expect(note.blockers).toEqual([]);
    // page, card, and the server function module (data, not walked further).
    expect(note.modules).toBe(3);
    expect(note.portable).toBe(true);
    expect(rules(routeOf(result, "/drafts"))).toEqual([
      "src/components/widget.tsx:2:16 runtime-class-name <span> builds its class names at runtime",
    ]);
    // The root layout's stylesheet blocks a route without a native layout to replace it.
    await fs.rm(path.join(root, "src/app/layout.native.tsx"));
    const again = await report(root);
    expect(rules(routeOf(again, "/web"))).toEqual([
      'src/app/layout.tsx:1:1 css-import import "./globals.css" is a stylesheet',
    ]);
    expect(routeOf(again, "/notes/[id]").analysis!.blockers.map((blocker) => blocker.file)).toEqual(
      ["src/app/layout.tsx"],
    );
  });

  it("skips routes decided by files, the page, or config, and feeds config ports", async () => {
    const root = await createApp({
      "src/app/feed/page.tsx": `export default function Feed() { return <iframe src="/x" />; }\n`,
      "src/app/feed/page.native.tsx": `export default function Feed() { return null; }\n`,
      "src/app/off/page.tsx": `export const mobile = { native: false };\nexport default function Off() { return <canvas />; }\n`,
      "src/app/asked/page.tsx": `export default function Asked() { return <video src="/a.mp4" />; }\n`,
      "src/app/docs/page.md": "# Docs\n",
    });
    const result = await report(root, userConfig({ routes: { "/asked": { screen: "native" } } }));
    expect(routeOf(result, "/feed")).toEqual({
      route: "/feed",
      screen: "native",
      source: "file",
      file: "src/app/feed/page.native.tsx",
    });
    expect(routeOf(result, "/off")).toEqual({
      route: "/off",
      screen: "web",
      source: "page",
      file: "src/app/off/page.tsx",
    });
    expect(routeOf(result, "/asked")).toMatchObject({
      screen: "web",
      source: "config",
      requested: "native",
      analysis: { decision: "web", portable: false },
    });
    expect(result.warnings).toEqual([
      'native.routes["/asked"].screen is "native", but "/asked" has no page.native.tsx and Farm cannot port pages yet, so it stays web. The analyzer would keep it web: src/app/asked/page.tsx:1:42 <video> has no native mapping. This fails the build once native screens ship.',
    ]);
    expect(rules(routeOf(result, "/docs"))).toEqual([
      "src/app/docs/page.md:1:1 markdown-page a Markdown page renders HTML from Markdown",
    ]);
    expect(result.table).toMatch(/\/feed\s+native\s+-\s+src\/app\/feed\/page\.native\.tsx/);
  });

  it("blocks server components and async pages", async () => {
    const root = await createApp({
      "src/app/page.tsx": `export default function Home() { return <p>home</p>; }\n`,
      "src/app/client/page.tsx": `"use client";\nexport default function Client() { return <p>c</p>; }\n`,
      "src/app/async/page.tsx": `async function Page() { return <p>a</p>; }\nexport default Page;\n`,
    });
    const rsc = await report(root, userConfig({}, { experimental: { serverComponents: true } }));
    expect(rules(routeOf(rsc, "/"))).toEqual([
      'src/app/page.tsx:1:1 server-component a server component (no "use client") renders on the server',
      'src/app/layout.tsx:1:1 server-component a server component (no "use client") renders on the server',
    ]);
    expect(rules(routeOf(rsc, "/client"))).toEqual([
      'src/app/layout.tsx:1:1 server-component a server component (no "use client") renders on the server',
    ]);
    const plain = await report(root);
    expect(routeOf(plain, "/").analysis!.portable).toBe(true);
    expect(rules(routeOf(plain, "/async"))).toEqual([
      "src/app/async/page.tsx:1:1 async-component an async component renders on the server",
    ]);
  });

  it("parses each module once per run and reuses facts by content hash", async () => {
    const files: Record<string, string> = {
      "src/components/shared.tsx": `export function Shared() { return <p>shared</p>; }\n`,
    };
    for (let index = 0; index < 20; index += 1) {
      files[`src/app/r${index}/page.tsx`] =
        `import { Shared } from "@/components/shared";\nexport default function P() { return <div><Shared /></div>; }\n`;
    }
    const root = await createApp(files);
    const first = await report(root);
    // 20 pages, the layout, and the shared component, each parsed once.
    expect(first.analyzerStats).toMatchObject({ modules: 22, parsed: 22, cached: 0 });
    const second = await report(root);
    expect(second.analyzerStats).toMatchObject({ modules: 22, parsed: 0, cached: 22 });
    expect(second.report).toEqual(first.report);
    await fs.writeFile(
      path.join(root, "src/components/shared.tsx"),
      `export function Shared() { return <canvas />; }\n`,
    );
    const third = await report(root);
    expect(third.analyzerStats).toMatchObject({ parsed: 1, cached: 21 });
    expect(rules(routeOf(third, "/r7"))).toEqual([
      "src/components/shared.tsx:1:35 unmapped-element <canvas> has no native mapping",
    ]);
  });

  it("runs only when asked, and not with auto off unless forced", async () => {
    const root = await createApp({
      "src/app/page.tsx": "export default function P() { return null; }\n",
    });
    const { generateFarmMobileRoutes, resolveFarmMobileApp } = await loadFarmMobileRuntime();
    expect((await resolveFarmMobileApp({ root, userConfig: userConfig() })).report).toBeUndefined();
    const off = await generateFarmMobileRoutes({
      root,
      userConfig: userConfig({ auto: "off" }),
      analyze: true,
    });
    expect(off.report).toBeUndefined();
    await expect(
      fs.stat(path.join(root, ".farm/output/mobile/native-report.json")),
    ).rejects.toThrow();
    const forced = await generateFarmMobileRoutes({
      root,
      userConfig: userConfig({ auto: "off" }),
      analyze: "always",
    });
    expect(forced.report!.auto).toBe("off");
  });

  it("ports pages that navigate with navigateTo, the documented client API", async () => {
    const root = await createApp({
      "src/app/page.tsx": `"use client";
import { Link, navigateTo } from "@farm.js/core/client";
const items = ["a", "b"];
export default function Home() {
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>
          <button onClick={() => navigateTo("/items/" + item)}>{item}</button>
        </li>
      ))}
      <Link href="/about">About</Link>
    </ul>
  );
}
`,
    });
    const home = routeOf(await report(root), "/");
    expect(rules(home)).toEqual([]);
    expect(home.analysis!.decision).toBe("port");
  });

  it("lists only names each @farm.js/core entry really exports", async () => {
    const pkg = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8")) as {
      exports: Record<string, { import: string }>;
    };
    // tsup entry name -> source file, so the check needs no build.
    const tsup = await fs.readFile(path.resolve("tsup.config.ts"), "utf8");
    const sources = new Map(
      [...tsup.matchAll(/^\s+"?([\w/-]+)"?: "(src\/[^"]+)",$/gm)].map((match) => [
        match[1],
        match[2],
      ]),
    );
    for (const [specifier, names] of Object.entries(CORE_PORTABLE)) {
      const entry = pkg.exports[specifier.replace("@farm.js/core", ".")]?.import;
      const source = sources.get(entry?.replace(/^\.\/dist\//, "").replace(/\.mjs$/, "") ?? "");
      expect(source, specifier).toBeDefined();
      const module = (await import(path.resolve(source!))) as Record<string, unknown>;
      expect(
        [...names].filter((name) => !(name in module)),
        specifier,
      ).toEqual([]);
    }
  }, 60_000);
});
