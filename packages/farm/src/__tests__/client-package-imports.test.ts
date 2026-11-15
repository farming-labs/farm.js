import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectFarmClientPackageImports,
  collectFarmServerBundledPackageInfo,
  collectFarmServerBundledPackages,
  resolveFarmClientOptimizeDeps,
} from "../utils/client-component";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-packages-")));
  roots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  }
  return root;
}

describe("packages the browser loads once a page renders", () => {
  it("are a client module's packages and the client packages server modules import", () => {
    const root = project({
      "node_modules/theme-kit/package.json": '{"name":"theme-kit","main":"index.js"}',
      "node_modules/theme-kit/index.js": '"use client";\nexport function ThemeProvider() {}\n',
      "node_modules/db-driver/package.json": '{"name":"db-driver","main":"index.js"}',
      "node_modules/db-driver/index.js": "export function connect() {}\n",
      "src/app/page.tsx":
        'import { ThemeProvider } from "theme-kit";\nimport { connect } from "db-driver";\nimport "server-only";\nimport { helper } from "./helper";\nimport fs from "node:fs";\nexport default function Page() { return <ThemeProvider />; }\n',
      "src/components/chart.tsx":
        '"use client";\nimport { useQuery } from "@tanstack/react-query";\nimport type { Options } from "chart-types";\nimport "chart-kit/styles.css";\nimport { Line } from "chart-kit/line";\nexport function Chart() { return <Line />; }\n',
      "src/app/node_modules/ignored/index.ts": '"use client";\nimport "should-not-appear";\n',
    });
    expect(collectFarmClientPackageImports(path.join(root, "src"), root)).toEqual([
      "@tanstack/react-query",
      "chart-kit/line",
      "theme-kit",
    ]);
  });
});

describe("packages that re-export another package", () => {
  it("reach that package's client modules, but not through re-export text in a string", () => {
    // Shaped like motion: `motion/react-client` is `export * from "framer-motion/client"`. Farm's
    // core keeps a virtual module's source as a string, which is not a re-export.
    const root = project({
      "node_modules/client-kit/package.json": '{"name":"client-kit","main":"index.js"}',
      "node_modules/client-kit/index.js": '"use client";\nexport function Box() {}\n',
      "node_modules/reexport-kit/package.json": '{"name":"reexport-kit","main":"index.js"}',
      "node_modules/reexport-kit/index.js": 'export * from "client-kit";\n',
      "node_modules/string-kit/package.json": '{"name":"string-kit","main":"index.js"}',
      "node_modules/string-kit/index.js":
        "export const source = 'export { Box } from \"client-kit\";';\n",
      "src/app/page.tsx":
        'import { Box } from "reexport-kit";\nimport { source } from "string-kit";\nexport default () => null;\n',
    });
    expect(collectFarmClientPackageImports(path.join(root, "src"), root)).toEqual(["reexport-kit"]);
  });
});

describe("modules client code reaches", () => {
  it("are the use client modules and what they import, not modules only server code imports", async () => {
    const { getFarmClientReachableModules } = await import("../utils/client-component");
    const root = project({
      "src/components/button.tsx":
        '"use client";\nimport { useLabel } from "../lib/shared";\nexport function Button() { return useLabel(); }\n',
      "src/lib/shared.ts":
        'import { helper } from "./deep";\nexport const useLabel = () => helper();\n',
      "src/lib/deep.ts": "export const helper = () => 1;\n",
      "src/lib/server-data.ts": "export const read = () => 2;\n",
      "src/app/page.tsx":
        'import { read } from "../lib/server-data";\nimport { Button } from "../components/button";\nexport default () => <Button>{read()}</Button>;\n',
    });
    const reachable = getFarmClientReachableModules(path.join(root, "src"), root);
    expect([...reachable].map((file) => path.relative(root, file)).sort()).toEqual([
      path.join("src", "components", "button.tsx"),
      path.join("src", "lib", "deep.ts"),
      path.join("src", "lib", "shared.ts"),
    ]);
  });
});

describe("modules client code reaches lazily or through hydrate", () => {
  it("includes a use client module's lazy import and a hydrate module's imports", async () => {
    const { getFarmClientReachableModules } = await import("../utils/client-component");
    const root = project({
      "src/components/shell.tsx":
        '"use client";\nimport { lazy } from "react";\nexport const Widget = lazy(() => import("./widget"));\n',
      "src/components/widget.tsx": "export default function Widget() { return null; }\n",
      "src/app/form/page.tsx":
        'import { Field } from "../../lib/field";\nexport const hydrate = true;\nexport default () => <Field />;\n',
      "src/lib/field.tsx": "export function Field() { return null; }\n",
      "src/lib/server-data.ts": "export const read = () => 2;\n",
    });
    const reachable = getFarmClientReachableModules(path.join(root, "src"), root);
    expect([...reachable].map((file) => path.relative(root, file)).sort()).toEqual([
      path.join("src", "app", "form", "page.tsx"),
      path.join("src", "components", "shell.tsx"),
      path.join("src", "components", "widget.tsx"),
      path.join("src", "lib", "field.tsx"),
    ]);
  });
});

describe("packages the server graph bundles", () => {
  it("are the packages the app imports that import stylesheets or ship ESM only through module", () => {
    const root = project({
      "node_modules/tweet-kit/package.json": '{"name":"tweet-kit","main":"dist/index.js"}',
      "node_modules/tweet-kit/dist/index.js": 'export * from "./icons.js";\n',
      "node_modules/tweet-kit/dist/icons.js":
        'import s from "./icons.module.css";\nexport const icon = s;\n',
      "node_modules/plain-kit/package.json": '{"name":"plain-kit","main":"index.js"}',
      "node_modules/plain-kit/index.js": "export const plain = 1;\n",
      "node_modules/unused-styles/package.json": '{"name":"unused-styles","main":"index.js"}',
      "node_modules/unused-styles/index.js": 'import "./a.css";\n',
      "node_modules/legacy-dual/package.json":
        '{"name":"legacy-dual","main":"dist/index.js","module":"dist/index.mjs"}',
      "node_modules/legacy-dual/dist/index.js": "module.exports = { default: 1 };\n",
      "node_modules/modern-dual/package.json":
        '{"name":"modern-dual","main":"dist/index.js","module":"dist/index.mjs","exports":{".":{"import":"./dist/index.mjs","require":"./dist/index.js"}}}',
      // Farm's own packages import stylesheets too, and must stay one external copy.
      "node_modules/@farm.js/core/package.json": '{"name":"@farm.js/core","main":"index.js"}',
      "node_modules/@farm.js/core/index.js": 'import "./docs.css";\nexport const page = 1;\n',
      "src/page.tsx":
        'import { icon } from "tweet-kit";\nimport { plain } from "plain-kit";\nimport legacy from "legacy-dual";\nimport modern from "modern-dual";\nimport { page } from "@farm.js/core";\n',
    });
    expect(collectFarmServerBundledPackages(root)).toEqual(["legacy-dual", "tweet-kit"]);
    // Development pre-bundles the module-entry package; the stylesheet one stays unbundled.
    expect(collectFarmServerBundledPackageInfo(root)).toEqual([
      { name: "legacy-dual", prebundle: true },
      { name: "tweet-kit", prebundle: false },
    ]);
  });
});

describe("test files", () => {
  it("are not scanned: their packages run under the test runner, never in the app's graphs", () => {
    const root = project({
      "node_modules/test-styles/package.json": '{"name":"test-styles","main":"index.js"}',
      "node_modules/test-styles/index.js": 'import "./a.css";\nexport const s = 1;\n',
      "node_modules/test-client/package.json": '{"name":"test-client","main":"index.js"}',
      "node_modules/test-client/index.js": '"use client";\nexport function Probe() {}\n',
      "node_modules/app-styles/package.json": '{"name":"app-styles","main":"index.js"}',
      "node_modules/app-styles/index.js": 'import "./a.css";\nexport const s = 1;\n',
      "src/page.tsx": 'import { s } from "app-styles";\nexport default () => s;\n',
      "src/page.test.tsx":
        'import { s } from "test-styles";\nimport { Probe } from "test-client";\n',
      "src/lib/util.spec.ts": 'import { s } from "test-styles";\n',
      "src/__tests__/helpers.ts": '"use client";\nimport { Probe } from "test-client";\n',
    });
    expect(collectFarmServerBundledPackages(root)).toEqual(["app-styles"]);
    expect(collectFarmClientPackageImports(path.join(root, "src"), root)).toEqual([]);
  });
});

describe("server-bundled packages development pre-bundles", () => {
  it("are module-entry packages without dependencies whose required peers the app has", () => {
    const dual = (name: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ name, main: "dist/index.js", module: "dist/index.mjs", ...extra });
    const root = project({
      "node_modules/react/package.json": '{"name":"react","main":"index.js"}',
      "node_modules/icons/package.json": dual("icons", { peerDependencies: { react: "*" } }),
      "node_modules/charts/package.json": dual("charts", { dependencies: { clsx: "^2.0.0" } }),
      "node_modules/native-lib/package.json": dual("native-lib", {
        peerDependencies: { react: "*", "react-native": "*" },
      }),
      "node_modules/optional-peer/package.json": dual("optional-peer", {
        peerDependencies: { "react-native": "*" },
        peerDependenciesMeta: { "react-native": { optional: true } },
      }),
      "src/page.tsx":
        'import "icons";\nimport "charts";\nimport "native-lib";\nimport "optional-peer";\n',
    });
    expect(collectFarmServerBundledPackageInfo(root)).toEqual([
      // Under pnpm its own dependencies resolve only from its directory, not from a bundle.
      { name: "charts", prebundle: false },
      { name: "icons", prebundle: true },
      // A required peer the app does not have.
      { name: "native-lib", prebundle: false },
      { name: "optional-peer", prebundle: true },
    ]);
  });
});

describe("client pre-bundling under React Server Components", () => {
  it("leaves out a package whose server-imported build reaches an internal use client module", () => {
    // Shaped like @tanstack/react-query: a server component renders HydrationBoundary, which the
    // RSC dev server loads from the package itself, while a client component uses the hooks.
    const root = project({
      "node_modules/rq/package.json":
        '{"name":"rq","type":"module","exports":{".":"./index.js"},"dependencies":{"rq-core":"1","ui":"1"}}',
      "node_modules/rq/index.js":
        'import { HydrationBoundary } from "./boundary.js";\nimport "ui";\nexport * from "rq-core";\nexport { HydrationBoundary };\n',
      "node_modules/rq/boundary.js": '"use client";\nexport function HydrationBoundary() {}\n',
      "node_modules/rq-core/package.json": '{"name":"rq-core","main":"index.js"}',
      "node_modules/rq-core/index.js": "export class QueryClient {}\n",
      "node_modules/ui/package.json": '{"name":"ui","type":"module","main":"index.js"}',
      "node_modules/ui/index.js": 'import { Button } from "./button.js";\nexport { Button };\n',
      "node_modules/ui/button.js": '"use client";\nexport function Button() {}\n',
      "src/app/page.tsx":
        'import { HydrationBoundary } from "rq";\nimport { Button } from "ui";\nexport default () => null;\n',
      "src/todo.tsx": '"use client";\nimport { useQuery } from "rq";\n',
    });
    // `ui` is left out too, so `rq > ui` must not pre-bundle it either.
    expect(resolveFarmClientOptimizeDeps(path.join(root, "src"), root)).toEqual({
      include: ["rq > rq-core"],
      exclude: ["rq", "ui"],
    });
  });
});
