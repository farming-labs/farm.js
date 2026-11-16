// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findFarmClientOnlyImport } from "../islands-react-server-exports";

// What the client-only check parses: source texts it parses, and programs (ESTree ASTs) it builds.
const calls = vi.hoisted(() => ({ parsed: 0, programs: 0 }));
vi.mock("rolldown/parseAst", async (importOriginal) => {
  const actual = await importOriginal<typeof import("rolldown/parseAst")>();
  return {
    ...actual,
    parseAst: (...args: Parameters<typeof actual.parseAst>) => {
      calls.parsed++;
      calls.programs++;
      return actual.parseAst(...args);
    },
  };
});
vi.mock("rolldown/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("rolldown/utils")>();
  return {
    ...actual,
    parseSync: (...args: Parameters<typeof actual.parseSync>) => {
      calls.parsed++;
      const result = actual.parseSync(...args);
      return new Proxy(result, {
        get(target, key, receiver) {
          if (key === "program") calls.programs++;
          return Reflect.get(target, key, receiver);
        },
      });
    },
  };
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  calls.parsed = 0;
  calls.programs = 0;
});

const PAGES = 20;
const ICONS = 30;

function project(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-client-only-parse-")));
  roots.push(root);
  const write = (file: string, contents: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  };
  // Shaped like an icon library: a barrel re-exporting one module per icon, each of which imports
  // a shared factory.
  write("node_modules/icon-kit/package.json", '{"name":"icon-kit","exports":"./index.js"}');
  write("node_modules/icon-kit/create.js", "export function create(name) { return name; }\n");
  write(
    "node_modules/icon-kit/index.js",
    Array.from({ length: ICONS }, (_, icon) => {
      return `export { default as Icon${icon} } from "./icons/icon-${icon}.js";\n`;
    }).join(""),
  );
  for (let icon = 0; icon < ICONS; icon++) {
    write(
      `node_modules/icon-kit/icons/icon-${icon}.js`,
      `import { create } from "../create.js";\nconst node = [["path", { d: "M${icon} 0" }]];\nexport default create("icon-${icon}", node);\n`,
    );
  }
  return root;
}

describe("the client-only check of islands server modules", () => {
  it("parses each server module and package file once, without building their programs", () => {
    const root = project();
    for (let page = 0; page < PAGES; page++) {
      const code = `import { Icon${page} } from "icon-kit";\nimport { jsx } from "react/jsx-runtime";\nexport default function Page() { return jsx(Icon${page}, {}); }\n`;
      expect(
        findFarmClientOnlyImport(code, path.join(root, `src/app/p${page}/page.tsx`)),
      ).toBeNull();
    }
    // Every page, the barrel, each icon and the factory: once each, however many pages import them.
    expect(calls.parsed).toBe(PAGES + 1 + ICONS + 1);
    expect(calls.programs).toBe(0);
  });

  it("builds a program only for a module whose module record cannot answer", () => {
    const root = project();
    const page = path.join(root, "src/app/page.tsx");
    expect(findFarmClientOnlyImport('import type { Icon0 } from "icon-kit";\n', page)).toBeNull();
    expect(calls.programs).toBe(1);
  });
});
