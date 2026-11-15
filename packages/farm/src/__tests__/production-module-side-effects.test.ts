// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function writePackage(root: string, name: string, source: string) {
  const dir = path.join(root, "node_modules", name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", type: "module", main: "index.js" }),
  );
  await fs.writeFile(path.join(dir, "index.js"), source);
}

describe("production server build", () => {
  // Agent SDKs register defaults when their entry module loads: @openai/agents sets the
  // default model provider, and LangGraph sets up its AsyncLocalStorage. Dropping the
  // entry's top-level code left them unconfigured in production.
  it("keeps the import side effects of dependencies", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-side-effects-"));
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
      await writePackage(
        root,
        "fake-agents-core",
        [
          "let provider;",
          "export function setDefaultProvider(value) { provider = value; }",
          "export function run() {",
          '  if (!provider) throw new Error("No default provider set");',
          "  return provider.name;",
          "}",
        ].join("\n"),
      );
      await writePackage(
        root,
        "fake-agents",
        [
          'import { setDefaultProvider } from "fake-agents-core";',
          'setDefaultProvider({ name: "registered on import" });',
          'export * from "fake-agents-core";',
        ].join("\n"),
      );
      await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
      const app = path.join(root, "src", "app");
      await fs.mkdir(path.join(app, "api", "agent"), { recursive: true });
      await fs.writeFile(
        path.join(app, "layout.tsx"),
        "export default function Layout({ children }) { return <main>{children}</main>; }",
      );
      await fs.writeFile(
        path.join(app, "page.tsx"),
        "export default function Page() { return <p>home</p>; }",
      );
      await fs.writeFile(
        path.join(app, "api", "agent", "route.ts"),
        [
          'import { run } from "fake-agents";',
          "export function GET() { return Response.json({ provider: run() }); }",
        ].join("\n"),
      );

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          deploy: { target: "vercel" },
        },
        "production",
      );
      await build(config, { root, preset: "vercel" });
      const functionPath = path.resolve(
        root,
        config.deploy.outputDir,
        "functions",
        "__nitro.func",
        "index.mjs",
      );
      const { default: handler } = await import(
        /* @vite-ignore */ pathToFileURL(functionPath).href
      );

      const response = await handler.fetch(new Request("https://acme.test/api/agent"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ provider: "registered on import" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
