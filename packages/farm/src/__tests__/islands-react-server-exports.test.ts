import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findFarmClientOnlyImport,
  findFarmPackageManifest,
  isFarmClientExport,
  resolveFarmReactServerExport,
  rewriteFarmReactServerImports,
} from "../islands-react-server-exports";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-react-server-")));
  roots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  }
  return root;
}

// A package written for React Server Components: a server build under `react-server` that renders
// a server component, keeps a server-only helper, and re-exports a "use client" provider.
const kit = {
  "node_modules/rsc-kit/package.json": JSON.stringify({
    name: "rsc-kit",
    exports: {
      ".": { types: "./index.d.ts", "react-server": "./server.js", default: "./client.js" },
      "./same": { "react-server": "./same.js", default: "./same.js" },
      "./parts/*": { "react-server": "./server-parts/*.js", default: "./parts/*.js" },
    },
  }),
  "node_modules/rsc-kit/server.js":
    'export { Quote } from "./quote.js";\nexport * from "./provider-index.js";\nexport function greeting() { return "hi"; }\n',
  "node_modules/rsc-kit/quote.js": "export async function Quote() { return null; }\n",
  "node_modules/rsc-kit/provider-index.js": 'export { KitProvider } from "./provider.js";\n',
  "node_modules/rsc-kit/provider.js":
    '"use client";\nexport function KitProvider({ children }) { return children; }\n',
  "node_modules/rsc-kit/client.js": '"use client";\nexport function Quote() { return null; }\n',
  "node_modules/rsc-kit/same.js": "export const same = 1;\n",
  "node_modules/rsc-kit/server-parts/card.js": "export const Card = 1;\n",
  "node_modules/rsc-kit/parts/card.js": "export const Card = 2;\n",
  "node_modules/react/package.json": JSON.stringify({
    name: "react",
    exports: { ".": { "react-server": "./react.react-server.js", default: "./index.js" } },
  }),
  "node_modules/react/react.react-server.js": "",
  "node_modules/react/index.js": "",
  "node_modules/@farm.js/core/package.json": JSON.stringify({
    name: "@farm.js/core",
    exports: { "./client": { "react-server": "./client.rsc.js", default: "./client.js" } },
  }),
  "node_modules/@farm.js/core/client.rsc.js": "",
  "node_modules/@farm.js/core/client.js": "",
  "src/page.tsx": "",
};

describe("react-server builds in islands mode", () => {
  it("resolve a server module's import to the package's react-server build when it differs", () => {
    const root = project(kit);
    const page = path.join(root, "src/page.tsx");
    expect(resolveFarmReactServerExport(page, "rsc-kit")).toBe(
      path.join(root, "node_modules/rsc-kit/server.js"),
    );
    expect(resolveFarmReactServerExport(page, "rsc-kit/parts/card")).toBe(
      path.join(root, "node_modules/rsc-kit/server-parts/card.js"),
    );
    // One build for both, React itself, and a package that is not installed stay as they are.
    expect(resolveFarmReactServerExport(page, "rsc-kit/same")).toBeNull();
    expect(resolveFarmReactServerExport(page, "react")).toBeNull();
    // Farm's own packages: their react-server builds are for Farm's RSC engine.
    expect(resolveFarmReactServerExport(page, "@farm.js/core/client")).toBeNull();
    expect(resolveFarmReactServerExport(page, "missing-kit")).toBeNull();
  });

  it("give a server module client-only's react-server build, which rejects it as RSC does", () => {
    // The contract example depends on the real package.
    const page = path.resolve(__dirname, "../../../../examples/server-components/src/app/page.tsx");
    const file = resolveFarmReactServerExport(page, "client-only");
    expect(file && path.basename(file)).toBe("error.js");
    expect(fs.readFileSync(file!, "utf8")).toContain("cannot be imported from a Server Component");
  });

  it("trace a name through re-exports to a use client module", () => {
    const root = project(kit);
    const server = path.join(root, "node_modules/rsc-kit/server.js");
    expect(isFarmClientExport(server, "KitProvider")).toBe(true);
    expect(isFarmClientExport(server, "Quote")).toBe(false);
    expect(isFarmClientExport(server, "greeting")).toBe(false);
  });

  it("point server names at the react-server build and client names at their references", () => {
    const root = project(kit);
    const page = path.join(root, "src/page.tsx");
    const server = JSON.stringify(path.join(root, "node_modules/rsc-kit/server.js"));
    const serverFiles: string[] = [];
    const output = rewriteFarmReactServerImports({
      code: [
        'import "rsc-kit";',
        'import { Quote, KitProvider as Provider, greeting } from "rsc-kit";',
        'import * as Kit from "rsc-kit";',
        'import { useState } from "react";',
        "export default () => <Provider><Quote /><Kit.Quote />{greeting()}</Provider>;",
      ].join("\n"),
      file: page,
      reference: (specifier, name) => `/refs/${specifier}/${name}.tsx`,
      onServerFile: (file) => serverFiles.push(file),
    })!;
    expect(output).toContain(`import ${server};`);
    expect(output).toContain(`import { Quote as Quote } from ${server};`);
    expect(output).toContain(
      'import { KitProvider as Provider } from "/refs/rsc-kit/KitProvider.tsx";',
    );
    expect(output).toContain(`import { greeting as greeting } from ${server};`);
    expect(output).toMatch(/const Kit = Object\.freeze\(\{ Quote: __farm_react_server_0__ \}\);/);
    expect(output).toContain('import { useState } from "react";');
    expect(new Set(serverFiles)).toEqual(
      new Set([path.join(root, "node_modules/rsc-kit/server.js")]),
    );
  });

  it("list the dependency subpaths a package's own files import, for pre-bundling", () => {
    const root = project({
      "node_modules/kit/package.json": JSON.stringify({
        name: "kit",
        dependencies: { "use-sync-external-store": "1", dequal: "2" },
        peerDependencies: { react: "19" },
      }),
      "node_modules/kit/dist/index.mjs":
        'import { useSyncExternalStore } from "use-sync-external-store/shim";\nimport React from "react";\nimport "./local.mjs";\nexport const lazy = () => import("dequal/lite");\n',
      "node_modules/kit/node_modules/nested/index.js": 'import "use-sync-external-store/other";\n',
      "src/page.tsx": "",
    });
    expect(findFarmPackageManifest(path.join(root, "src/page.tsx"), "kit/sub")).toEqual({
      name: "kit",
      dependencies: ["dequal/lite", "use-sync-external-store/shim"],
    });
  });

  it("leave a module without such packages alone", () => {
    const root = project(kit);
    expect(
      rewriteFarmReactServerImports({
        code: 'import { useState } from "react";\nimport { same } from "rsc-kit/same";\n',
        file: path.join(root, "src/page.tsx"),
        reference: () => "",
      }),
    ).toBeNull();
  });

  describe("a package that reaches client-only", () => {
    const packages = {
      // Shaped like React Aria Components: the entry imports client-only without "use client".
      "node_modules/entry-kit/package.json": '{"name":"entry-kit","exports":"./index.js"}',
      "node_modules/entry-kit/index.js": 'import "client-only";\nexport const Button = 1;\n',
      "node_modules/deep-kit/package.json": '{"name":"deep-kit","exports":"./index.js"}',
      "node_modules/deep-kit/index.js": 'export { a } from "./a.js";\n',
      "node_modules/deep-kit/a.js": 'import "entry-kit";\nexport const a = 1;\n',
      "node_modules/boundary-kit/package.json": '{"name":"boundary-kit","exports":"./index.js"}',
      "node_modules/boundary-kit/index.js": 'export { b } from "./b.js";\n',
      "node_modules/boundary-kit/b.js":
        '"use client";\nimport "client-only";\nexport const b = 1;\n',
      // The build server components get has no client-only; only the browser's does.
      "node_modules/split-kit/package.json": JSON.stringify({
        name: "split-kit",
        exports: { ".": { "react-server": "./server.js", default: "./client.js" } },
      }),
      "node_modules/split-kit/server.js": "export const s = 1;\n",
      "node_modules/split-kit/client.js": 'import "client-only";\nexport const s = 1;\n',
      "node_modules/browser-kit/package.json": JSON.stringify({
        name: "browser-kit",
        exports: { ".": { browser: "./browser.js", default: "./node.js" } },
      }),
      "node_modules/browser-kit/browser.js": 'import "client-only";\nexport const n = 1;\n',
      "node_modules/browser-kit/node.js": "export const n = 1;\n",
    };

    it("names the import and the files between it and client-only", () => {
      const root = project(packages);
      const page = path.join(root, "src/page.tsx");
      expect(findFarmClientOnlyImport('import { Button } from "entry-kit";\n', page)).toEqual({
        specifier: "entry-kit",
        chain: [path.join(root, "node_modules/entry-kit/index.js")],
      });
      expect(findFarmClientOnlyImport('import { a } from "deep-kit";\n', page)).toEqual({
        specifier: "deep-kit",
        chain: [
          path.join(root, "node_modules/deep-kit/index.js"),
          path.join(root, "node_modules/deep-kit/a.js"),
          path.join(root, "node_modules/entry-kit/index.js"),
        ],
      });
    });

    it("ignores use client boundaries, the builds server code skips and type imports", () => {
      const root = project(packages);
      const page = path.join(root, "src/page.tsx");
      for (const code of [
        'import { b } from "boundary-kit";\n',
        'import { s } from "split-kit";\n',
        'import { n } from "browser-kit";\n',
        'import type { Button } from "entry-kit";\n',
      ]) {
        expect(findFarmClientOnlyImport(code, page)).toBeNull();
      }
    });

    it("finds a package again after an earlier import walked part of it clean", () => {
      const root = project(packages);
      const page = path.join(root, "src/page.tsx");
      expect(findFarmClientOnlyImport('import { b } from "boundary-kit";\n', page)).toBeNull();
      expect(findFarmClientOnlyImport('import { a } from "deep-kit";\n', page)).not.toBeNull();
    });
  });
});
