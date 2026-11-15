// A generated docs-sized React app whose client build splits into hundreds of chunks (see
// README.md). Deterministic: the same options always write the same files.
import fs from "node:fs";
import path from "node:path";

export const MARKER = "farm-client-chunking";

export const DEFAULTS = {
  sections: 12,
  pagesPerSection: 28,
  components: 120,
  uiModules: 260,
  icons: 600,
};

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

/** Mulberry32: a small seeded PRNG, so every run writes the same app. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "anchor badge banner beacon border button cadence canvas caption carousel chip column compass console cursor dialog divider drawer ember field filter focus footer frame gallery gauge glyph grid halo header helix index input keynote label lattice ledger lens marker meadow menu meter motion needle notice orbit outline panel parcel pillar pixel popover portal prism pulse radio range ribbon scroll select shadow signal slider spinner stack status stepper switch tab table tag thread tile toast toggle token tooltip track vertex viewport widget".split(
    " ",
  );

function pick(next, list, count) {
  const chosen = new Set();
  while (chosen.size < Math.min(count, list.length)) {
    chosen.add(list[Math.floor(next() * list.length)]);
  }
  return [...chosen];
}

function words(next, count) {
  return Array.from({ length: count }, () => WORDS[Math.floor(next() * WORDS.length)]);
}

/**
 * ui-kit: an ES module package shaped like a component library (Radix, a shadcn registry): one
 * module per component, each importing a few lower-level modules of the same package, and a
 * barrel. Module sizes vary from ~0.5 KB to ~4 KB of minified code.
 */
function writeUiKit(root, next, count) {
  write(
    root,
    "node_modules/ui-kit/package.json",
    JSON.stringify({
      name: "ui-kit",
      version: "1.0.0",
      type: "module",
      main: "dist/index.js",
      module: "dist/index.js",
      sideEffects: false,
      peerDependencies: { react: "*" },
    }),
  );
  const barrel = [];
  for (let index = 0; index < count; index++) {
    // Lower modules are primitives that many others import.
    const deps =
      index < 8
        ? []
        : pick(
            next,
            Array.from({ length: Math.min(index, 40) }, (_, offset) => index - 1 - offset),
            1 + Math.floor(next() * 3),
          );
    const tableSize = 20 + Math.floor(next() ** 1.5 * 420);
    const table = JSON.stringify(words(next, tableSize));
    const imports = deps.map((dep) => `import { helper${dep}, Widget${dep} } from "./m${dep}.js";`);
    const helperBody = deps.length
      ? deps.map((dep) => `hash ^= helper${dep}(value + ${index});`).join("\n  ")
      : `hash ^= ${index};`;
    write(
      root,
      `node_modules/ui-kit/dist/m${index}.js`,
      `import { createElement, useState } from "react";
${imports.join("\n")}
const TABLE_${index} = ${table};
export function helper${index}(value) {
  let hash = ${index * 31 + 7};
  for (let i = 0; i < value.length; i++) hash = (Math.imul(hash, 33) + value.charCodeAt(i)) | 0;
  ${helperBody}
  return hash;
}
export function Widget${index}(props) {
  const [active, setActive] = useState(0);
  const items = TABLE_${index}.filter((_, i) => (i + active) % ${2 + (index % 5)} !== 0);
  return createElement(
    "div",
    { "data-ui": ${index}, className: "ui-${index} " + (props.className || ""), onMouseEnter: () => setActive(helper${index}(String(active)) & 7) },
    ${deps.length ? `createElement(Widget${deps[0]}, { className: "nested" }),` : ""}
    createElement("span", null, items.slice(0, 3).join(" ")),
    props.children
  );
}
`,
    );
    barrel.push(`export * from "./m${index}.js";`);
  }
  write(root, "node_modules/ui-kit/dist/index.js", `${barrel.join("\n")}\n`);
}

/** icon-kit: one module per icon behind a side-effect-free barrel, like lucide-react. */
function writeIconKit(root, count) {
  write(
    root,
    "node_modules/icon-kit/package.json",
    JSON.stringify({
      name: "icon-kit",
      version: "1.0.0",
      type: "module",
      main: "dist/index.js",
      sideEffects: false,
      peerDependencies: { react: "*" },
    }),
  );
  const barrel = [];
  for (let index = 0; index < count; index++) {
    write(
      root,
      `node_modules/icon-kit/dist/icons/icon-${index}.js`,
      `import { createElement } from "react";
export default function Icon${index}(props) {
  return createElement("svg", { ...props, "data-icon": ${index}, viewBox: "0 0 24 24" },
    createElement("path", { d: "M${index % 24} 0L24 ${index % 24}l-${index % 11} ${index % 7}z" }));
}
`,
    );
    barrel.push(`export { default as Icon${index} } from "./icons/icon-${index}.js";`);
  }
  write(root, "node_modules/icon-kit/dist/index.js", `${barrel.join("\n")}\n`);
}

/** A large package only a few routes import statically (a charting library). */
function writeChartKit(root, next) {
  write(
    root,
    "node_modules/chart-kit/package.json",
    JSON.stringify({
      name: "chart-kit",
      version: "1.0.0",
      type: "module",
      main: "index.js",
      sideEffects: false,
    }),
  );
  const series = Array.from({ length: 40 }, (_, index) => {
    const table = JSON.stringify(words(next, 160));
    return `const SERIES_${index} = ${table};
export function scale${index}(value) { return SERIES_${index}[value % SERIES_${index}.length] + ":" + value * ${index + 1}; }`;
  });
  write(
    root,
    "node_modules/chart-kit/index.js",
    `${series.join("\n")}
export function renderChart(points) {
  return points.map((point, index) => [${Array.from({ length: 40 }, (_, index) => `scale${index}`).join(", ")}][index % 40](point));
}
`,
  );
}

/** A syntax highlighter the docs load with a dynamic import, like Shiki. */
function writeHighlightKit(root, next) {
  write(
    root,
    "node_modules/highlight-kit/package.json",
    JSON.stringify({
      name: "highlight-kit",
      version: "1.0.0",
      type: "module",
      main: "index.js",
      sideEffects: false,
    }),
  );
  const grammars = Array.from(
    { length: 30 },
    (_, index) => `  g${index}: ${JSON.stringify(words(next, 140))},`,
  );
  write(
    root,
    "node_modules/highlight-kit/index.js",
    `const GRAMMARS = {
${grammars.join("\n")}
};
export function highlight(code) {
  const grammar = GRAMMARS["g" + (code.length % 30)];
  return code.split(" ").map((word, index) => grammar[index % grammar.length] + ":" + word).join(" ");
}
`,
  );
}

/**
 * Write the app into `root`, linking `@farm.js/core` and `@farm.js/cli` from the given package
 * directories. Returns its routes.
 */
export function createApp(root, options) {
  const settings = { ...DEFAULTS, ...options };
  const next = random(0x5eed);
  const nodeModules = path.join(root, "node_modules");
  link(settings.corePath, path.join(nodeModules, "@farm.js/core"));
  link(settings.cliPath, path.join(nodeModules, "@farm.js/cli"));
  for (const name of ["react", "react-dom"]) {
    link(
      fs.realpathSync(path.join(settings.corePath, "node_modules", name)),
      path.join(nodeModules, name),
    );
  }
  writeUiKit(root, next, settings.uiModules);
  writeIconKit(root, settings.icons);
  writeChartKit(root, next);
  writeHighlightKit(root, next);

  const uiIndexes = Array.from({ length: settings.uiModules }, (_, index) => index);
  const families = settings.sections;
  const componentIndexes = Array.from({ length: settings.components }, (_, index) => index);

  // Shared client components. Each belongs to a family (a docs section) and leans on that
  // family's slice of ui-kit, plus a few widely shared primitives.
  for (let index = 0; index < settings.components; index++) {
    const family = index % families;
    const familySlice = uiIndexes.filter((ui) => ui % families === family);
    const ui = [
      ...pick(next, familySlice, 2 + Math.floor(next() * 4)),
      ...pick(next, uiIndexes, 1 + Math.floor(next() * 3)),
    ];
    const icons = pick(
      next,
      Array.from({ length: settings.icons }, (_, icon) => icon),
      2,
    );
    const uses = [...new Set(ui)];
    // Every sixth component also renders a styles-only module shared with one other
    // component: the shape that leaves a CSS-only chunk in the bundle graph.
    const stylesheet = index % 6 === 0 ? `import "./styles/shared-${index % 4}.css";\n` : "";
    const chart = index % families === 3 && index < families * 2;
    const highlight = index % 7 === 1;
    write(
      root,
      `src/components/c${index}.tsx`,
      `"use client";
${stylesheet}import { ${uses.map((ui) => `Widget${ui}`).join(", ")} } from "ui-kit";
import { ${icons.map((icon) => `Icon${icon}`).join(", ")} } from "icon-kit";
${chart ? 'import { renderChart } from "chart-kit";\n' : ""}import { ${highlight ? "lazy, Suspense, " : ""}useState } from "react";
${highlight ? `const CodeBlock = lazy(() => import("./code-block"));\n` : ""}
export function C${index}({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <section className="component c${index}" data-component="${index}">
      <h3>{label} ${words(next, 3).join(" ")}</h3>
      ${uses.map((ui) => `<Widget${ui} />`).join("\n      ")}
      ${icons.map((icon) => `<Icon${icon} width={16} />`).join(" ")}
      ${chart ? `<p data-chart>{renderChart([1, 2, 3]).join(" ")}</p>` : ""}
      ${highlight ? `<Suspense fallback={<pre>loading</pre>}><CodeBlock code="const answer = ${index};" /></Suspense>` : ""}
      <button type="button" data-counter="${index}" onClick={() => setCount(count + 1)}>
        c${index}:{count}
      </button>
    </section>
  );
}
`,
    );
  }
  for (let index = 0; index < 4; index++) {
    write(
      root,
      `src/components/styles/shared-${index}.css`,
      `.shared-${index} { border: ${index + 1}px solid #ccc; padding: ${index * 2}px; }\n`,
    );
  }
  write(
    root,
    "src/components/code-block.tsx",
    `"use client";
import { highlight } from "highlight-kit";

export default function CodeBlock({ code }: { code: string }) {
  return <pre data-highlighted>{highlight(code)}</pre>;
}
`,
  );

  // The site header every page hydrates with: the root layout's client component.
  const headerUi = pick(next, uiIndexes.slice(0, 40), 6);
  write(
    root,
    "src/components/site-header.tsx",
    `"use client";
import { useState } from "react";
import { ${headerUi.map((ui) => `Widget${ui}`).join(", ")} } from "ui-kit";
import { Icon1, Icon2, Icon3 } from "icon-kit";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header data-site-header>
      <Icon1 width={20} /> Farm chunking fixture
      ${headerUi.map((ui) => `<Widget${ui} />`).join("\n      ")}
      <button type="button" data-menu onClick={() => setOpen(!open)}>
        {open ? <Icon2 width={16} /> : <Icon3 width={16} />} menu:{open ? "open" : "closed"}
      </button>
    </header>
  );
}
`,
  );

  const routes = ["/"];
  for (let section = 0; section < settings.sections; section++) {
    const family = componentIndexes.filter((component) => component % families === section);
    for (let page = 0; page < settings.pagesPerSection; page++) {
      const pathname = `/docs/s${section}/p${page}`;
      routes.push(pathname);
      const used = [
        ...pick(next, family, 2 + Math.floor(next() * 3)),
        ...pick(next, componentIndexes, 1 + Math.floor(next() * 2)),
      ];
      const components = [...new Set(used)];
      write(
        root,
        `src/app${pathname}/page.tsx`,
        `${components.map((component) => `import { C${component} } from "@/components/c${component}";`).join("\n")}

export const metadata = { title: "Section ${section} page ${page}" };

export default function Page() {
  return (
    <article data-page="${pathname}">
      <h1>Section ${section} page ${page}</h1>
      <p>${words(next, 40).join(" ")}</p>
      ${components.map((component) => `<C${component} label="s${section}p${page}" />`).join("\n      ")}
    </article>
  );
}
`,
      );
    }
  }
  write(
    root,
    "src/app/page.tsx",
    `import { C0 } from "@/components/c0";

export const metadata = { title: "Home" };

export default function Home() {
  return (
    <article data-page="/">
      <h1>Home</h1>
      <C0 label="home" />
    </article>
  );
}
`,
  );
  const nav = routes.filter((route) => route.endsWith("/p0"));
  write(
    root,
    "src/app/layout.tsx",
    `import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const sections = ${JSON.stringify(nav)};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-marker="${MARKER}">
      <SiteHeader />
      <nav>
        {sections.map((href) => (
          <a key={href} href={href}>{href}</a>
        ))}
      </nav>
      <main>{children}</main>
    </div>
  );
}
`,
  );
  write(
    root,
    "src/app/globals.css",
    "body { font-family: system-ui, sans-serif; margin: 0; }\nmain { padding: 1rem; }\n",
  );
  write(
    root,
    "package.json",
    JSON.stringify({
      name: "farm-client-chunking-fixture",
      private: true,
      type: "module",
    }),
  );
  write(
    root,
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        module: "esnext",
        moduleResolution: "bundler",
        target: "es2022",
        strict: false,
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
      },
    }),
  );
  write(
    root,
    "farm.config.ts",
    `export default { telemetry: false, images: { provider: "none" }${settings.config ? `, ${settings.config}` : ""} };\n`,
  );
  return routes;
}
