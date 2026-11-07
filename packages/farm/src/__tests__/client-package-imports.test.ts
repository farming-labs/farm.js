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
