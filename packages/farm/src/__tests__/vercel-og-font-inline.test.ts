// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createVercelOgFontInlinePlugin } from "../nitro/universal-build";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/** Writes a fake @vercel/og package and returns the path of its edge entry. */
async function createVercelOgPackage(version: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-vercel-og-font-"));
  temporaryDirectories.push(root);
  const packageDir = path.join(root, "node_modules", "@vercel", "og");
  await mkdir(path.join(packageDir, "dist"), { recursive: true });
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "@vercel/og", version }),
  );
  await writeFile(path.join(packageDir, "dist", "Font.ttf"), Buffer.from([1, 2, 3]));
  return path.join(packageDir, "dist", "index.edge.js");
}

function runTransform(code: string, id: string, runtime?: string) {
  const plugin = createVercelOgFontInlinePlugin(runtime);
  const context = {
    error(message: string): never {
      throw new Error(message);
    },
  };
  return (plugin.transform as (this: typeof context, code: string, id: string) => unknown).call(
    context,
    code,
    id,
  );
}

describe("@vercel/og font inlining for edge runtimes", () => {
  it("inlines the default font the edge build fetches from import.meta.url", async () => {
    const entry = await createVercelOgPackage("1.0.1");
    const result = runTransform(
      `var font = fetch(new URL("./Font.ttf", import.meta.url)).then((res) => res.arrayBuffer());`,
      entry,
    ) as { code: string };

    expect(result.code).not.toContain("import.meta.url");
    expect(result.code).toContain(JSON.stringify(Buffer.from([1, 2, 3]).toString("base64")));
  });

  it("fails the build, naming the version, when the font fetch is not found", async () => {
    const entry = await createVercelOgPackage("9.9.9");

    expect(() =>
      runTransform(`var font = loadFont("./Font.ttf").then((res) => res.arrayBuffer());`, entry),
    ).toThrow(/@vercel\/og 9\.9\.9 cannot be bundled for Cloudflare Workers/);
    expect(() =>
      runTransform(
        `var font = loadFont("./Font.ttf").then((res) => res.arrayBuffer());`,
        entry,
        "Netlify Edge Functions",
      ),
    ).toThrow(/@vercel\/og 9\.9\.9 cannot be bundled for Netlify Edge Functions/);
  });

  it("leaves other modules and @vercel/og's wasm files alone", async () => {
    const entry = await createVercelOgPackage("1.0.1");

    expect(runTransform("export default 1;", "/app/src/route.ts")).toBeNull();
    expect(
      runTransform("binary", path.join(path.dirname(entry), "resvg.wasm") + "?module"),
    ).toBeNull();
  });
});
