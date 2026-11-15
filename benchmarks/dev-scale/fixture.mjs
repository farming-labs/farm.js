// Generates a docs-sized Farm app inside a pnpm-style workspace (see README.md).
import fs from "node:fs";
import path from "node:path";

export const MARKER = "farm-dev-scale";

function write(root, file, contents) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function link(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  fs.symlinkSync(target, linkPath, "junction");
}

/** The packages the fixture links from the Farm checkout it runs against. */
const HEAVY_PACKAGES = ["lucide-react", "motion", "cmdk", "sonner", "@radix-ui/react-dialog"];

/**
 * A workspace shaped like a large docs monorepo:
 *
 * - `packages/ui`: a workspace component library (`@fixture/ui`) linked into the app the way pnpm
 *   links a workspace package, with TSX sources outside `node_modules`. It has context providers,
 *   client components that consume them, client components built on heavy npm packages, and plain
 *   server components.
 * - `apps/docs`: the Farm app, in islands mode. Its root layout renders `PlatformProvider`, and the
 *   docs layout renders a workspace server component that renders `DocsSidebarProvider` around the
 *   sidebar and the page. Pages are mostly MDX, whose MDX components include consumers of both
 *   providers, plus TSX pages that render consumers, icons and package-built client components.
 */
export function createDevScaleFixture(workspace, options) {
  const {
    farmRepo,
    mdxPages,
    tsxPages,
    primitives,
    mode = "islands",
    staticPages = false,
  } = options;
  const app = path.join(workspace, "apps/docs");
  const ui = path.join(workspace, "packages/ui");
  const appModules = path.join(app, "node_modules");
  const uiModules = path.join(ui, "node_modules");

  write(workspace, "package.json", JSON.stringify({ name: "dev-scale", private: true }));
  write(workspace, "pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n");

  link(path.join(farmRepo, "packages/farm"), path.join(appModules, "@farm.js/core"));
  link(path.join(farmRepo, "packages/farm-cli"), path.join(appModules, "@farm.js/cli"));
  const reactModules = path.join(farmRepo, "packages/farm/node_modules");
  const heavyModules = path.join(farmRepo, "examples/server-components/node_modules");
  for (const modules of [appModules, uiModules]) {
    for (const name of ["react", "react-dom"]) {
      link(fs.realpathSync(path.join(reactModules, name)), path.join(modules, name));
    }
    for (const name of HEAVY_PACKAGES) {
      link(fs.realpathSync(path.join(heavyModules, name)), path.join(modules, name));
    }
  }
  // pnpm links a workspace dependency as a symlink to its source directory.
  link(ui, path.join(appModules, "@fixture/ui"));

  writeUiPackage(ui, primitives);
  const pages = writeApp(app, { mdxPages, tsxPages, primitives, mode, staticPages });
  return { workspace, app, ui, ...pages };
}

function writeUiPackage(ui, primitives) {
  write(
    ui,
    "package.json",
    JSON.stringify(
      {
        name: "@fixture/ui",
        version: "0.0.0",
        private: true,
        type: "module",
        sideEffects: false,
        exports: {
          "./primitives": "./src/primitives/index.ts",
          "./*": "./src/*.tsx",
        },
        peerDependencies: { react: "*" },
        dependencies: Object.fromEntries(HEAVY_PACKAGES.map((name) => [name, "*"])),
      },
      null,
      2,
    ),
  );
  write(
    ui,
    "src/providers.tsx",
    `"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

const PlatformContext = createContext<{ platform: string } | null>(null);

export function PlatformProvider({ platform, children }: { platform: string; children: ReactNode }) {
  return <PlatformContext.Provider value={{ platform }}>{children}</PlatformContext.Provider>;
}

export function usePlatform() {
  const value = useContext(PlatformContext);
  if (!value) throw new Error("usePlatform must be used within PlatformProvider");
  return value;
}

const SidebarContext = createContext<{ open: boolean; toggle: () => void } | null>(null);

export function DocsSidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <SidebarContext.Provider value={{ open, toggle: () => setOpen((value) => !value) }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) throw new Error("useSidebar must be used within DocsSidebarProvider");
  return value;
}
`,
  );
  write(
    ui,
    "src/platform-badge.tsx",
    `"use client";
import { useId, useState } from "react";
import { usePlatform } from "./providers";

export function PlatformBadge() {
  const { platform } = usePlatform();
  const id = useId();
  const [clicks, setClicks] = useState(0);
  return (
    <button type="button" id={id} data-platform-badge={platform} data-clicks={clicks} onClick={() => setClicks((n) => n + 1)}>
      platform badge v0: {platform}
    </button>
  );
}
`,
  );
  write(
    ui,
    "src/sidebar.tsx",
    `"use client";
import { ChevronRight, PanelLeft } from "lucide-react";
import { useSidebar } from "./providers";

export function DocsSidebar({ items }: { items: { href: string; title: string }[] }) {
  const { open, toggle } = useSidebar();
  return (
    <aside data-sidebar={open ? "open" : "closed"}>
      <button type="button" data-sidebar-toggle onClick={toggle}>
        <PanelLeft size={14} /> sidebar
      </button>
      {open ? (
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              <a href={item.href}>
                <ChevronRight size={12} /> {item.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

export function SidebarState() {
  const { open } = useSidebar();
  return <span data-sidebar-state={open ? "open" : "closed"}>sidebar state</span>;
}
`,
  );
  write(
    ui,
    "src/docs-shell.tsx",
    `import type { ReactNode } from "react";
import { DocsSidebarProvider } from "./providers";
import { DocsSidebar } from "./sidebar";

export function DocsShell({ items, children }: { items: { href: string; title: string }[]; children: ReactNode }) {
  return (
    <DocsSidebarProvider>
      <div className="docs-shell">
        <DocsSidebar items={items} />
        <div className="docs-content">{children}</div>
      </div>
    </DocsSidebarProvider>
  );
}
`,
  );
  write(
    ui,
    "src/copy-button.tsx",
    `"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" data-copy={text} onClick={() => setCopied(true)}>
      {copied ? <Check size={12} /> : <Copy size={12} />} copy label v0
    </button>
  );
}
`,
  );
  write(
    ui,
    "src/motion-card.tsx",
    `"use client";
import { motion } from "motion/react";
import type { ReactNode } from "react";

export function MotionCard({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0.9 }} animate={{ opacity: 1 }} className="motion-card">
      {children}
    </motion.div>
  );
}
`,
  );
  write(
    ui,
    "src/command-menu.tsx",
    `"use client";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useState } from "react";

export function CommandMenu({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger data-command-trigger>search</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content>
          <Dialog.Title>Search</Dialog.Title>
          <Command>
            <Command.Input />
            <Command.List>
              {items.map((item) => (
                <Command.Item key={item} onSelect={() => toast(item)}>
                  {item}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
`,
  );
  write(
    ui,
    "src/toaster.tsx",
    `"use client";
export { Toaster } from "sonner";
`,
  );
  const barrel = [];
  for (let index = 0; index < primitives; index++) {
    write(
      ui,
      `src/primitives/primitive-${index}.tsx`,
      `import type { ReactNode } from "react";

export function Primitive${index}({ children, tone = "plain" }: { children?: ReactNode; tone?: string }) {
  return <div className="primitive primitive-${index}" data-tone={tone}>{children}</div>;
}
`,
    );
    barrel.push(`export { Primitive${index} } from "./primitive-${index}";`);
  }
  write(ui, "src/primitives/index.ts", `${barrel.join("\n")}\n`);
  write(
    ui,
    "src/callout.tsx",
    `import type { ReactNode } from "react";
import { Info } from "lucide-react";

export function Callout({ children }: { children: ReactNode }) {
  return <aside className="callout"><Info size={14} /> callout text v0 {children}</aside>;
}
`,
  );
}

function writeApp(app, { mdxPages, tsxPages, primitives, mode, staticPages }) {
  // `staticPages` prerenders every page at build time, as a docs site does.
  const staticExport = staticPages ? '\nexport const dynamic = "force-static";\n' : "";
  write(
    app,
    "package.json",
    JSON.stringify(
      {
        name: "docs",
        private: true,
        type: "module",
        dependencies: {
          "@farm.js/core": "workspace:*",
          "@fixture/ui": "workspace:*",
          react: "*",
          "react-dom": "*",
          ...Object.fromEntries(HEAVY_PACKAGES.map((name) => [name, "*"])),
        },
      },
      null,
      2,
    ),
  );
  write(
    app,
    "farm.config.ts",
    `export default {
  telemetry: false,
  images: { provider: "none" },
  experimental: { serverComponents: ${mode === "classic" ? "false" : '{ mode: "islands" }'} },
  mdx: { components: "./src/mdx-components.tsx" },
};
`,
  );
  write(
    app,
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          jsx: "react-jsx",
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          paths: { "@/*": ["./src/*"] },
        },
      },
      null,
      2,
    ),
  );

  const sections = Math.max(1, Math.ceil(mdxPages / 40));
  const mdx = [];
  for (let index = 0; index < mdxPages; index++) {
    const pathname = `/docs/section-${index % sections}/page-${index}`;
    mdx.push(pathname);
    write(
      app,
      `src/app${pathname}/page.mdx`,
      `---
title: Doc ${index}
description: Generated MDX page ${index}
---
${staticExport}
# Doc ${index}

mdx body v0 for page ${index}. A paragraph with **bold** text, \`code\`, and a [link](/docs/section-${(index + 1) % sections}/page-${(index + 1) % mdxPages}).

<Callout>Note ${index}</Callout>

<PlatformBadge />

<SidebarState />

| Column | Value |
| ------ | ----- |
| a      | ${index} |

\`\`\`ts
export const value${index} = ${index};
\`\`\`

<CopyButton text="doc-${index}" />
`,
    );
  }

  const tsx = [];
  for (let index = 0; index < tsxPages; index++) {
    const pathname = `/guides/page-${index}`;
    tsx.push(pathname);
    const asyncPage = index % 5 === 0;
    const primitive = index % Math.max(1, primitives);
    write(
      app,
      `src/app${pathname}/page.tsx`,
      `import { Book, Code, Terminal } from "lucide-react";
import { Primitive${primitive} } from "@fixture/ui/primitives";
import { Callout } from "@fixture/ui/callout";
import { CopyButton } from "@fixture/ui/copy-button";
import { PlatformBadge } from "@fixture/ui/platform-badge";
import { SidebarState } from "@fixture/ui/sidebar";
${index % 10 === 1 ? 'import { MotionCard } from "@fixture/ui/motion-card";\n' : ""}${index % 10 === 2 ? 'import { CommandMenu } from "@fixture/ui/command-menu";\n' : ""}import { GuideFooter } from "@/components/guide-footer";

export const metadata = { title: "Guide ${index}" };

${asyncPage ? "export default async function Page() {\n  const data = await Promise.resolve({ updated: " + index + " });" : "export default function Page() {\n  const data = { updated: " + index + " };"}
  return (
    <article>
      <h1><Book size={16} /> Guide ${index}</h1>
      <p data-guide-body>guide body v0 for page ${index}</p>
      <Primitive${primitive} tone="info">
        <Callout><Code size={12} /> Updated {data.updated}</Callout>
      </Primitive${primitive}>
      <PlatformBadge />
      <SidebarState />
      <CopyButton text="guide-${index}" />
${index % 10 === 1 ? "      <MotionCard>animated</MotionCard>\n" : ""}${index % 10 === 2 ? '      <CommandMenu items={["one", "two", "three"]} />\n' : ""}      <GuideFooter index={${index}} icon={<Terminal size={12} />} />
    </article>
  );
}
${staticExport}`,
    );
  }

  write(
    app,
    "src/components/guide-footer.tsx",
    `import type { ReactNode } from "react";

export function GuideFooter({ index, icon }: { index: number; icon: ReactNode }) {
  return <footer className="guide-footer">{icon} guide footer v0 #{index}</footer>;
}
`,
  );
  write(
    app,
    "src/mdx-components.tsx",
    `import { Callout } from "@fixture/ui/callout";
import { CopyButton } from "@fixture/ui/copy-button";
import { PlatformBadge } from "@fixture/ui/platform-badge";
import { SidebarState } from "@fixture/ui/sidebar";

export const components = { Callout, CopyButton, PlatformBadge, SidebarState };
`,
  );
  const nav = [...mdx.slice(0, 30), ...tsx.slice(0, 10)].map((href) => ({
    href,
    title: href.split("/").pop(),
  }));
  write(
    app,
    "src/app/layout.tsx",
    `import type { ReactNode } from "react";
import { PlatformProvider } from "@fixture/ui/providers";
import { Toaster } from "@fixture/ui/toaster";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body data-marker="${MARKER}">
        <PlatformProvider platform="web">
          <header data-layout-header>root layout v0</header>
          {children}
        </PlatformProvider>
        <Toaster />
      </body>
    </html>
  );
}
`,
  );
  const shell = `import type { ReactNode } from "react";
import { DocsShell } from "@fixture/ui/docs-shell";

const items = ${JSON.stringify(nav)};

export default function SectionLayout({ children }: { children: ReactNode }) {
  return <DocsShell items={items}>{children}</DocsShell>;
}
`;
  write(app, "src/app/docs/layout.tsx", shell);
  write(app, "src/app/guides/layout.tsx", shell);
  write(
    app,
    "src/app/globals.css",
    `body { font-family: sans-serif; }\n.callout { color: rgb(1, 2, 3); }\n`,
  );
  write(
    app,
    "src/app/page.tsx",
    `export default function Home() {
  return <h1>Home</h1>;
}
`,
  );
  return { mdx, tsx };
}
