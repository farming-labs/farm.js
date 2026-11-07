import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectFarmClientPackageImports } from "../utils/client-component";

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
