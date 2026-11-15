import assert from "node:assert/strict";
import { test } from "node:test";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { measureJavaScriptOutput } from "./javascript-output-size.mjs";

function chunk(fileName, code, options = {}) {
  return {
    type: "chunk",
    fileName,
    code,
    isEntry: false,
    imports: [],
    dynamicImports: [],
    ...options,
  };
}

function size(code) {
  return {
    raw: Buffer.byteLength(code),
    gzip: gzipSync(code, { level: 9 }).length,
    brotli: brotliCompressSync(code).length,
  };
}

function sum(chunks) {
  return chunks.reduce(
    (total, { code }) => {
      const bytes = size(code);
      for (const key of Object.keys(total)) total[key] += bytes[key];
      return total;
    },
    { raw: 0, gzip: 0, brotli: 0 },
  );
}

test("single-chunk bytes preserve the existing compression settings, including UTF-8", () => {
  const code = 'console.log("🌱 café");\n';
  const result = measureJavaScriptOutput({ output: [chunk("entry.js", code, { isEntry: true })] });
  for (const key of ["raw", "gzip", "brotli"]) assert.equal(result[key], size(code)[key]);
  assert.equal(result.code, code);
});

for (const encoding of ["raw", "gzip", "brotli"]) {
  test(`multiple chunks use independent ${encoding} byte counts`, () => {
    const code = 'console.log("shared words repeated across files");'.repeat(50);
    const chunks = [
      chunk("entry.js", code, { isEntry: true, dynamicImports: ["lazy.js"] }),
      chunk("lazy.js", code),
    ];
    const result = measureJavaScriptOutput({ output: chunks });
    assert.equal(result[encoding], sum(chunks)[encoding]);
    assert.notEqual(result[encoding], size(chunks.map((item) => item.code).join("\n"))[encoding]);
  });
}

test("shared static chunks and cycles count once; nested lazy dependencies stay deferred", () => {
  const chunks = [
    chunk("a.js", "entry a", {
      isEntry: true,
      imports: ["shared.js"],
      dynamicImports: ["lazy.js"],
    }),
    chunk("b.js", "entry b", { isEntry: true, imports: ["shared.js"] }),
    chunk("shared.js", "shared", { imports: ["a.js"] }),
    chunk("lazy.js", "lazy", {
      imports: ["shared.js", "lazy-shared.js"],
      dynamicImports: ["nested.js"],
    }),
    chunk("lazy-shared.js", "lazy shared", { imports: ["lazy.js"] }),
    chunk("nested.js", "nested", { imports: ["lazy-shared.js"] }),
    chunk("unreferenced.js", "emitted but unreferenced"),
  ];
  const result = measureJavaScriptOutput({ output: chunks });
  assert.deepEqual(result.chunkAccounting.initial, sum(chunks.slice(0, 3)));
  assert.deepEqual(result.chunkAccounting.deferred, sum(chunks.slice(3, 6)));
  assert.deepEqual(result.chunkAccounting.unreferenced, sum(chunks.slice(6)));
  assert.deepEqual(
    result.chunkAccounting.files.map((file) => file.loading),
    ["initial", "initial", "initial", "deferred", "deferred", "deferred", "unreferenced"],
  );
  for (const key of ["raw", "gzip", "brotli"]) assert.equal(result[key], sum(chunks)[key]);
});

test("static reachability wins when a chunk is also dynamically imported", () => {
  const chunks = [
    chunk("entry.js", "entry", {
      isEntry: true,
      imports: ["shared.js"],
      dynamicImports: ["shared.js"],
    }),
    chunk("shared.js", "shared"),
  ];
  const result = measureJavaScriptOutput({ output: chunks });
  assert.deepEqual(result.chunkAccounting.initial, sum(chunks));
  assert.deepEqual(result.chunkAccounting.deferred, sum([]));
});

test("assets and external imports are not counted as emitted JavaScript", () => {
  const entry = chunk("entry.js", "entry", {
    isEntry: true,
    imports: ["react", "https://cdn.example/app.js"],
  });
  const result = measureJavaScriptOutput({
    output: [entry, { type: "asset", fileName: "style.css", source: "css" }],
  });
  assert.equal(result.code, "entry");
  assert.deepEqual(result.chunkAccounting.initial, size("entry"));
  assert.equal(result.chunkAccounting.files.length, 1);
});

test("output arrays preserve independent entries and do not mutate bundler output", () => {
  const outputs = [
    { output: [chunk("one.js", "one", { isEntry: true })] },
    { output: [chunk("two.js", "two", { isEntry: true })] },
  ];
  const copy = structuredClone(outputs);
  const result = measureJavaScriptOutput(outputs);
  assert.deepEqual(outputs, copy);
  assert.deepEqual(result.chunkAccounting.initial, sum(outputs.flatMap((output) => output.output)));
  assert.equal(result.code, "one\ntwo");
});

test("ambiguous duplicate filenames and missing JS entries fail explicitly", () => {
  assert.throws(
    () =>
      measureJavaScriptOutput({
        output: [chunk("same.js", "a", { isEntry: true }), chunk("same.js", "b")],
      }),
    /Duplicate.*same.js/,
  );
  assert.throws(() => measureJavaScriptOutput({ output: [] }), /JavaScript entry/);
  assert.throws(
    () => measureJavaScriptOutput({ output: [chunk("orphan.js", "orphan")] }),
    /JavaScript entry/,
  );
});

test("real Vite output separates shared initial code from nested dynamic imports", async () => {
  const sources = new Map([
    [
      "virtual:size-first",
      'import {record} from "virtual:size-shared"; record("first"); globalThis.loadLazy = () => import("virtual:size-lazy");',
    ],
    ["virtual:size-second", 'import {record} from "virtual:size-shared"; record("second");'],
    ["virtual:size-shared", "export function record(value) { globalThis.trace.push(value); }"],
    [
      "virtual:size-lazy",
      'import {record} from "virtual:size-shared"; export function run() { record("lazy"); return import("virtual:size-nested"); }',
    ],
    ["virtual:size-nested", "export const value = globalThis.dynamicValue;"],
  ]);
  const result = await build({
    root: fileURLToPath(new URL("../fixtures/runtime-size/", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    css: { postcss: { plugins: [] } },
    plugins: [
      {
        name: "size-accounting-fixture",
        resolveId(id) {
          if (sources.has(id)) return `\0${id}`;
        },
        load(id) {
          return sources.get(id.slice(1));
        },
      },
    ],
    build: {
      write: false,
      minify: "esbuild",
      rollupOptions: { input: { first: "virtual:size-first", second: "virtual:size-second" } },
    },
  });
  const chunks = [result]
    .flat()
    .flatMap((output) => output.output)
    .filter((output) => output.type === "chunk");
  const deferred = chunks.filter((item) =>
    ["\0virtual:size-lazy", "\0virtual:size-nested"].includes(item.facadeModuleId),
  );
  const shared = chunks.find((item) => Object.hasOwn(item.modules, "\0virtual:size-shared"));
  assert.equal(chunks.filter((item) => item.isEntry).length, 2);
  assert.equal(deferred.length, 2);
  assert.ok(
    shared && !shared.isEntry && !deferred.includes(shared),
    "fixture must emit shared initial code",
  );
  const measured = measureJavaScriptOutput(result);
  const initial = chunks.filter((item) => !deferred.includes(item));
  assert.deepEqual(measured.chunkAccounting.initial, sum(initial));
  assert.deepEqual(measured.chunkAccounting.deferred, sum(deferred));
  assert.deepEqual(measured.chunkAccounting.unreferenced, sum([]));
  for (const key of ["raw", "gzip", "brotli"]) assert.equal(measured[key], sum(chunks)[key]);
  assert.deepEqual(
    measured.chunkAccounting.files.map(({ fileName, raw, gzip, brotli }) => ({
      fileName,
      raw,
      gzip,
      brotli,
    })),
    chunks.map(({ fileName, code }) => ({ fileName, ...size(code) })),
  );
});
