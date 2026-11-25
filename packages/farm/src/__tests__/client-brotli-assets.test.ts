// @vitest-environment node

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { writeFarmClientBrotliAssets } from "../nitro/client-brotli-assets";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function clientOutput(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "farm-client-brotli-"));
  dirs.push(dir);
  for (const [name, source] of Object.entries(files)) {
    await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), source);
  }
  return dir;
}

const script = `export const values = [${Array.from({ length: 400 }, (_, i) => i).join(", ")}];\n`;

describe("writeFarmClientBrotliAssets", () => {
  it("writes a brotli copy of each script and stylesheet that decodes to the same bytes", async () => {
    const css = `.card { padding: 1rem; }\n`.repeat(80);
    const dir = await clientOutput({
      "farm-client-h0123abcd.js": script,
      "chunks/nested/page-h89abcdef.js": script,
      "chunks/worker-h0123abcd.mjs": script,
      "assets/farm-client-h0123abcd.css": css,
    });
    await writeFarmClientBrotliAssets(dir);
    for (const [file, source] of [
      ["farm-client-h0123abcd.js", script],
      ["chunks/nested/page-h89abcdef.js", script],
      ["chunks/worker-h0123abcd.mjs", script],
      ["assets/farm-client-h0123abcd.css", css],
    ]) {
      const compressed = await readFile(join(dir, `${file}.br`));
      expect(compressed.length, file).toBeLessThan(source!.length);
      expect(brotliDecompressSync(compressed).toString(), file).toBe(source);
    }
  });

  it("leaves small files, other file types and the app's own brotli copies alone", async () => {
    const dir = await clientOutput({
      "chunks/tiny-h0123abcd.js": "export const a = 1;\n",
      "index.html": `<p>${"page ".repeat(400)}</p>`,
      "data.json": JSON.stringify({ values: script }),
      "icon.svg": `<svg>${"<g></g>".repeat(400)}</svg>`,
      "vendor.js": script,
      "vendor.js.br": "the app's own copy",
    });
    await writeFarmClientBrotliAssets(dir);
    for (const file of ["chunks/tiny-h0123abcd.js", "index.html", "data.json", "icon.svg"]) {
      expect(existsSync(join(dir, `${file}.br`)), file).toBe(false);
    }
    expect(await readFile(join(dir, "vendor.js.br"), "utf8")).toBe("the app's own copy");
  });
});
