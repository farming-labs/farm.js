// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const precompiled = vi.hoisted(() => ({ calls: [] as string[][] }));

// Records which page bodies the build compiles and marks the code it hands the prerender pass, so
// the artifact shows whether the prerender ran that code or compiled the page again.
vi.mock("../build/markdown-precompile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../build/markdown-precompile")>();
  return {
    ...actual,
    precompileFarmMarkdownPages: (bodies: readonly string[], coreRoot: string | null) => {
      precompiled.calls.push([...bodies]);
      const result = actual.precompileFarmMarkdownPages(bodies, coreRoot);
      return {
        ...result,
        pages: result.pages.then(
          (pages) =>
            new Map(
              [...pages].map(([body, code]) => [
                body,
                code.replaceAll("Rendered from source", "Rendered from precompiled code"),
              ]),
            ),
        ),
      };
    },
  };
});

describe("production Markdown prerendering", () => {
  it("compiles each prerendered MDX page once in the build and runs that code in the prerender", async () => {
    const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-markdown-precompile-"));
    const write = async (relativePath: string, source: string) => {
      await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
      await fs.writeFile(path.join(root, relativePath), source);
    };
    const staticPages = ["alpha", "beta", "gamma"];

    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(
        packageRoot,
        path.join(root, "node_modules", "@farm.js", "core"),
        "junction",
      );
      await write("package.json", '{"type":"module","private":true}');
      await write(
        "src/app/layout.tsx",
        "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
      );
      for (const name of staticPages) {
        await write(
          `src/app/docs/${name}/page.mdx`,
          [
            "---",
            `title: ${name}`,
            "---",
            'export const dynamic = "force-static";',
            "",
            `# Rendered from source: ${name}`,
            "",
            "| page | value |",
            "| ---- | ----- |",
            `| ${name} | {1 + 1} |`,
          ].join("\n"),
        );
      }
      await write("src/app/docs/live/page.mdx", "# Rendered from source per request\n");

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          telemetry: false,
          images: { provider: "none" },
          deploy: { target: "node-server" },
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      // One build, one compile of each static page, none of the page rendered per request.
      expect(precompiled.calls).toHaveLength(1);
      const [bodies] = precompiled.calls;
      expect(bodies).toHaveLength(staticPages.length);
      for (const name of staticPages) {
        expect(
          bodies.filter((body) => body.includes(`Rendered from source: ${name}`)),
        ).toHaveLength(1);
      }

      const publicDir = path.join(root, ".farm", ".output", "public");
      for (const name of staticPages) {
        const artifact = await fs.readFile(
          path.join(publicDir, "docs", name, "index.html"),
          "utf8",
        );
        expect(artifact).toContain(`<h1>Rendered from precompiled code: ${name}</h1>`);
        expect(artifact).toContain(`<td>${name}</td><td>2</td>`);
      }

      // The deployed server is not given the build's code: it compiles pages when they render.
      const serverDir = path.join(root, ".farm", ".output", "server");
      const serverFiles = await fs.readdir(serverDir, { recursive: true });
      for (const file of serverFiles) {
        if (!/\.m?js$/.test(file)) continue;
        const code = await fs.readFile(path.join(serverDir, file), "utf8");
        expect(code).not.toContain("Rendered from precompiled code");
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 180_000);
});
