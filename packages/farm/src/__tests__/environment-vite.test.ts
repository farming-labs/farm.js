// @vitest-environment node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build, type Rollup } from "vite";
import { farmEnvironmentFunctionsPlugin } from "../environment-vite";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("client-only reached from islands server code", () => {
  const files: Record<string, string> = {
    "node_modules/aria-kit/package.json": '{"name":"aria-kit","exports":"./index.js"}',
    "node_modules/aria-kit/index.js": 'import "client-only";\nexport const Button = "b";\n',
    "src/lib/styles.ts": "export const label = 1;\n",
  };

  async function buildIslands(page: string, extra: Record<string, string> = {}) {
    const root = mkdtempSync(path.join(tmpdir(), "farm-client-only-"));
    temporaryRoots.push(root);
    for (const [file, contents] of Object.entries({ ...files, ...extra, "src/page.ts": page })) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), contents);
    }
    await build({
      root,
      logLevel: "silent",
      plugins: [
        farmEnvironmentFunctionsPlugin({
          root,
          srcDir: "src",
          experimental: { serverComponents: { mode: "islands" } },
        }),
      ],
      build: {
        ssr: path.join(root, "src/page.ts"),
        write: false,
        rolldownOptions: { external: ["client-only"] },
      },
      ssr: { noExternal: true },
    });
  }

  it("fails the build and names the chain", async () => {
    await expect(
      buildIslands('import { Button } from "aria-kit";\nexport default Button;\n'),
    ).rejects.toThrow(/import of "aria-kit" reaches "client-only".*"use client"/s);
  });

  it("ignores an import TypeScript erases", async () => {
    await expect(
      buildIslands('import { Button } from "aria-kit";\nexport const size: Button = 1 as never;\n'),
    ).resolves.toBeUndefined();
  });

  it("allows a module client code reaches", async () => {
    await expect(
      buildIslands('import { label } from "./lib/shared";\nexport default label;\n', {
        "src/client.tsx":
          '"use client";\nimport { label } from "./lib/shared";\nexport { label };\n',
        "src/lib/shared.ts": 'import { Button } from "aria-kit";\nexport const label = Button;\n',
      }),
    ).resolves.toBeUndefined();
  });
  it("allows client modules outside srcDir and what they import", async () => {
    await expect(
      buildIslands('import { label } from "../lib/client";\nexport default label;\n', {
        "lib/client.ts": '"use client";\nexport { label } from "./helper";\n',
        "lib/helper.ts": 'import { Button } from "aria-kit";\nexport const label = Button;\n',
      }),
    ).resolves.toBeUndefined();
  });

  it("allows a client module outside the scanned directories", async () => {
    await expect(
      buildIslands('import { label } from "../.shared/client";\nexport default label;\n', {
        ".shared/client.ts":
          '"use client";\nimport { Button } from "aria-kit";\nexport const label = Button;\n',
      }),
    ).resolves.toBeUndefined();
  });

  it("still fails for server code outside srcDir", async () => {
    await expect(
      buildIslands('import { label } from "../lib/server";\nexport default label;\n', {
        "lib/server.ts": 'import { Button } from "aria-kit";\nexport const label = Button;\n',
      }),
    ).rejects.toThrow(/reaches "client-only"/);
  });
});

describe("environment function Vite transform", () => {
  it("removes server implementations from client chunks", async () => {
    const output = await buildFixture(false);

    expect(output).not.toContain("SERVER_ONLY_SECRET");
    expect(output).not.toContain("ISOMORPHIC_SERVER_SECRET");
    expect(output).not.toContain("NESTED_SERVER_SECRET");
    expect(output).not.toContain("NAMESPACE_SERVER_SECRET");
    expect(output).not.toContain("SERVER_ENTRY_SECRET");
    expect(output).toContain("CLIENT_ONLY_VALUE");
    expect(output).toContain("ISOMORPHIC_CLIENT_VALUE");
    expect(output).toContain("NESTED_CLIENT_VALUE");
    expect(output).toContain("NAMESPACE_CLIENT_VALUE");
    expect(output).toContain("createServerOnlyFn");
    expect(output).toContain("SHADOWED_CALL_VALUE");
    expect(output).toContain("LOOP_SHADOWED_CALL_VALUE");
    expect(output).toContain("VAR_SHADOWED_CALL_VALUE");
  });

  it("removes client implementations from server chunks", async () => {
    const output = await buildFixture(true);

    expect(output).toContain("SERVER_ONLY_SECRET");
    expect(output).toContain("ISOMORPHIC_SERVER_SECRET");
    expect(output).toContain("NESTED_SERVER_SECRET");
    expect(output).toContain("NAMESPACE_SERVER_SECRET");
    expect(output).toContain("SERVER_ENTRY_SECRET");
    expect(output).not.toContain("CLIENT_ONLY_VALUE");
    expect(output).not.toContain("ISOMORPHIC_CLIENT_VALUE");
    expect(output).not.toContain("NESTED_CLIENT_VALUE");
    expect(output).not.toContain("NAMESPACE_CLIENT_VALUE");
    expect(output).toContain("createClientOnlyFn");
    expect(output).toContain("SHADOWED_CALL_VALUE");
    expect(output).toContain("LOOP_SHADOWED_CALL_VALUE");
    expect(output).toContain("VAR_SHADOWED_CALL_VALUE");
  });

  it("rejects isomorphic options that cannot be statically selected", async () => {
    const root = createFixtureRoot();
    const entry = path.join(root, "entry.ts");
    writeFileSync(
      entry,
      `
        import { createIsomorphicFn } from "@farm.js/core/environment";
        const implementations = { server: () => "server", client: () => "client" };
        export const target = createIsomorphicFn(implementations);
      `,
    );

    await expect(buildEntry(root, entry, false)).rejects.toThrow(
      "createIsomorphicFn() requires an inline options object",
    );
  });
});

async function buildFixture(ssr: boolean): Promise<string> {
  const root = createFixtureRoot();
  const entry = path.join(root, "entry.ts");
  writeFileSync(
    entry,
    `
      import {
        createClientOnlyFn as clientOnly,
        createIsomorphicFn,
        createServerOnlyFn as serverOnly,
      } from "@farm.js/core";
      import * as environment from "@farm.js/core/environment";
      import { createServerOnlyFn as serverEntryOnly } from "@farm.js/core/server";

      export const serverValue = serverOnly(() => "SERVER_ONLY_SECRET");
      export const clientValue = clientOnly(() => "CLIENT_ONLY_VALUE");
      export const isomorphicValue = createIsomorphicFn({
        server(value) { return "ISOMORPHIC_SERVER_SECRET:" + value; },
        client(value) { return "ISOMORPHIC_CLIENT_VALUE:" + value; },
      });
      export const nestedValue = createIsomorphicFn({
        server: serverOnly(() => "NESTED_SERVER_SECRET"),
        client: clientOnly(() => "NESTED_CLIENT_VALUE"),
      });
      export const namespaceServer = environment.createServerOnlyFn(
        () => "NAMESPACE_SERVER_SECRET",
      );
      export const namespaceClient = environment.createClientOnlyFn(
        () => "NAMESPACE_CLIENT_VALUE",
      );
      export const serverEntryValue = serverEntryOnly(() => "SERVER_ENTRY_SECRET");
      export function callShadowed(serverOnly) {
        return serverOnly(() => "SHADOWED_CALL_VALUE");
      }
      export function callLoopShadowed() {
        for (const serverOnly of [(implementation) => implementation]) {
          return serverOnly(() => "LOOP_SHADOWED_CALL_VALUE");
        }
      }
      export function callVarShadowed() {
        {
          var serverOnly = (implementation) => implementation;
        }
        return serverOnly(() => "VAR_SHADOWED_CALL_VALUE");
      }
    `,
  );

  return buildEntry(root, entry, ssr);
}

async function buildEntry(root: string, entry: string, ssr: boolean): Promise<string> {
  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [farmEnvironmentFunctionsPlugin()],
    build: {
      ssr,
      write: false,
      minify: false,
      target: "esnext",
      rollupOptions: {
        input: entry,
        external: ["@farm.js/core", "@farm.js/core/environment", "@farm.js/core/server"],
        preserveEntrySignatures: "strict",
        onwarn(warning, warn) {
          if (warning.code !== "UNUSED_EXTERNAL_IMPORT") warn(warning);
        },
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];

  return outputs
    .flatMap((output) => output.output)
    .filter((item): item is Rollup.OutputChunk => item.type === "chunk")
    .map((chunk) => chunk.code)
    .join("\n");
}

function createFixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "farm-environment-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "src"), { recursive: true });
  return root;
}
