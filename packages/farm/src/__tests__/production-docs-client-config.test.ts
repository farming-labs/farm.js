// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { redactFarmDocsClientConfig } from "../docs/client-config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SECRETS = ["ADMIN-HARDCODED", "sk-test-HARDCODED", "HEADER-HARDCODED", "SHORTHAND-HARDCODED"];

const DOCS_CONFIG = `const apiKey = "SHORTHAND-HARDCODED";
export default {
  entry: "docs",
  nav: { title: "Leak Docs" },
  theme: { tokens: { accent: "ACCENT-PUBLIC" } },
  search: { provider: "algolia", appId: "APPID", indexName: "docs", adminApiKey: "ADMIN-HARDCODED" },
  ai: { enabled: true, apiKey: "sk-test-HARDCODED", model: process.env.DOCS_AI_MODEL ?? "gpt" },
  cloud: { apiKey },
  mcp: { headers: { "X-Docs-Session": "HEADER-HARDCODED" } },
  onCopyClick() { return "CALLBACK-PUBLIC"; },
};
`;

async function write(root: string, relativePath: string, source: string) {
  await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
  await fs.writeFile(path.join(root, relativePath), source);
}

async function readTree(directory: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files.set(path.relative(directory, file), await fs.readFile(file, "utf8"));
  }
  return files;
}

describe("docs config in the client bundle", () => {
  it("redacts credential values and keeps everything else", () => {
    const redacted = redactFarmDocsClientConfig(DOCS_CONFIG, "docs.config.ts")!;
    for (const secret of ["ADMIN-HARDCODED", "sk-test-HARDCODED", "HEADER-HARDCODED"]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain('cloud: { "apiKey": undefined }');
    expect(redacted).toContain('tokens: { accent: "ACCENT-PUBLIC" }');
    expect(redacted).toContain("CALLBACK-PUBLIC");
  });

  it("ships no hard-coded docs credential in a production client build", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-client-config-"));
    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(
        packageRoot,
        path.join(root, "node_modules", "@farm.js", "core"),
        "junction",
      );
      for (const name of ["react", "react-dom"]) {
        await fs.symlink(
          await fs.realpath(path.join(packageRoot, "node_modules", name)),
          path.join(root, "node_modules", name),
          "junction",
        );
      }
      // A minimal adapter: the client runtime imports the docs config module for it.
      await write(
        root,
        "node_modules/fake-docs-adapter/package.json",
        JSON.stringify({
          name: "fake-docs-adapter",
          type: "module",
          exports: { "./server": "./server.js", "./react": "./react.js" },
        }),
      );
      await write(
        root,
        "node_modules/fake-docs-adapter/server.js",
        "export function createFarmDocsRuntimeHandler() { return async () => null; }",
      );
      await write(
        root,
        "node_modules/fake-docs-adapter/react.js",
        "export function hydrateFarmDocs() {}",
      );
      await write(root, "package.json", '{"type":"module","private":true}');
      await write(root, "docs.config.ts", DOCS_CONFIG);
      await write(root, "src/app/docs/page.md", "# Docs\n");
      await write(
        root,
        "src/app/layout.tsx",
        "export default function Layout({ children }) { return <main>{children}</main>; }",
      );
      await write(
        root,
        "src/app/page.tsx",
        "export default function Page() { return <p>home</p>; }",
      );

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          deploy: { target: "vercel" },
          docs: {
            enabled: true,
            entry: "/docs",
            adapter: {
              id: "fake",
              protocol: 1,
              server: "fake-docs-adapter/server",
              react: "fake-docs-adapter/react",
            },
          },
        },
        "production",
      );
      expect(config.docs.configPath).toBe(path.join(root, "docs.config.ts"));
      await build(config, { root, preset: "vercel" });

      const client = await readTree(path.resolve(root, config.deploy.outputDir, "static"));
      const configChunk = [...client].find(([, source]) => source.includes("Leak Docs"));
      // The config module is in the client bundle, so the scan below is meaningful.
      expect(configChunk?.[1]).toContain("ACCENT-PUBLIC");
      for (const [file, source] of client) {
        for (const secret of SECRETS) {
          expect(source.includes(secret), `${secret} in ${file}`).toBe(false);
        }
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
