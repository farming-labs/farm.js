import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";
import { createFarmRendererPlugin } from "../dist/vite.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/runtime-size");
async function bundle(kind, fullControl) {
  let replaced = false;
  const result = await build({
    root,
    configFile: false,
    logLevel: "silent",
    css: { postcss: { plugins: [] } },
    plugins: [
      ...createFarmRendererPlugin({
        rendererOptions: { experimental: { compiler: { onUnsupported: "error" } } },
      }),
      {
        name: "full-target-runtime-control",
        enforce: "post",
        transform(code, id) {
          if (!fullControl || !id.endsWith(`keyed-${kind}.tsx`)) return;
          const control = code.replace(
            /keyedRows(?:Identity|Membership|MapLookup)RuntimeFeature/g,
            () => {
              replaced = true;
              return "keyedRowsRuntimeFeature";
            },
          );
          return { code: control, map: null };
        },
      },
    ],
    build: {
      write: false,
      minify: "esbuild",
      rollupOptions: { input: join(root, `keyed-${kind}.tsx`) },
    },
  });
  if (fullControl) assert.ok(replaced, "control must replace a specialized compiler feature");
  const code = [result]
    .flat()
    .flatMap((output) => output.output)
    .filter((output) => output.type === "chunk")
    .map((output) => output.code)
    .join("\n");
  return { code, raw: Buffer.byteLength(code), gzip: gzipSync(code, { level: 9 }).length };
}

const results = [];
for (const kind of ["identity", "membership", "map-lookup"]) {
  const full = await bundle(kind, true);
  const specialized = await bundle(kind, false);
  assert.ok(specialized.code.includes(`keyed-rows:${kind}`));
  if (kind === "identity") {
    for (const marker of ["Set.prototype.has", "Map.prototype.get"]) {
      assert.ok(full.code.includes(marker), `control must retain ${marker}`);
      assert.ok(!specialized.code.includes(marker), `identity runtime must not retain ${marker}`);
    }
  }
  assert.ok(specialized.gzip < full.gzip, `${kind} specialization must reduce gzip payload`);
  results.push({
    kind,
    full: { raw: full.raw, gzip: full.gzip },
    specialized: { raw: specialized.raw, gzip: specialized.gzip },
    savedGzip: full.gzip - specialized.gzip,
  });
}
console.log(JSON.stringify({ node: process.version, results }, null, 2));
