import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { render as renderStrata, renderJson as renderStrataJson } from "@farming-labs/strata";
import React from "react";
import { renderToPipeableStream } from "react-server-dom-webpack/server.node";
import { encodeDocument, generateDocument } from "./src/document.mjs";
import { renderDocumentToHtml, renderIr } from "./src/render-js.mjs";
import { RscDocument, RscOpaqueHtmlDocument } from "./src/rsc-tree.mjs";
import { createStrataDocument } from "./src/strata-document.mjs";

const benchmarkDirectory = path.dirname(fileURLToPath(import.meta.url));
const generatedDirectory = path.join(benchmarkDirectory, "generated");
const resultsDirectory = path.join(benchmarkDirectory, "results");
const rustDirectory = path.join(benchmarkDirectory, "rust");
const wasmBinary = path.join(
  rustDirectory,
  "target",
  "wasm32-unknown-unknown",
  "release",
  "farm_ui_renderer_benchmark.wasm",
);
const fixtureDefinitions = {
  small: { sections: 6, rendererIterations: 1_000, flightIterations: 160 },
  medium: { sections: 24, rendererIterations: 300, flightIterations: 50 },
  large: { sections: 96, rendererIterations: 75, flightIterations: 12 },
};

function run(command, arguments_, options = {}) {
  execFileSync(command, arguments_, {
    cwd: options.cwd ?? benchmarkDirectory,
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeRedundantTextEscapes(html) {
  // Both forms produce the same text nodes. Strata avoids escaping quotes in
  // text content, while the comparison renderer escapes them redundantly.
  return html.replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

function byteSizes(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return {
    raw: buffer.byteLength,
    gzip: gzipSync(buffer, { level: 9 }).byteLength,
    brotli: brotliCompressSync(buffer, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      },
    }).byteLength,
  };
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function benchmarkSync(callback, iterations, warmups = 20) {
  for (let index = 0; index < warmups; index += 1) callback();
  const start = performance.now();
  let result;
  for (let index = 0; index < iterations; index += 1) result = callback();
  const totalMs = performance.now() - start;
  return {
    iterations,
    totalMs: round(totalMs),
    perIterationUs: round((totalMs * 1_000) / iterations),
    outputBytes:
      typeof result === "string" ? Buffer.byteLength(result) : (result?.byteLength ?? undefined),
  };
}

async function renderFlightModel(model) {
  return new Promise((resolve, reject) => {
    const destination = new PassThrough();
    const chunks = [];
    destination.on("data", (chunk) => chunks.push(chunk));
    destination.on("error", reject);
    destination.on("end", () => resolve(Buffer.concat(chunks)));

    const stream = renderToPipeableStream(
      model,
      {},
      {
        onError(error) {
          reject(error);
        },
      },
    );
    stream.pipe(destination);
  });
}

function renderFlight(document) {
  return renderFlightModel(React.createElement(RscDocument, { document }));
}

function renderOpaqueHtmlFlight(html) {
  return renderFlightModel(React.createElement(RscOpaqueHtmlDocument, { html }));
}

async function benchmarkFlight(render, iterations, warmups = 10) {
  for (let index = 0; index < warmups; index += 1) await render();
  const start = performance.now();
  let result;
  for (let index = 0; index < iterations; index += 1) {
    result = await render();
  }
  const totalMs = performance.now() - start;
  return {
    iterations,
    totalMs: round(totalMs),
    perIterationUs: round((totalMs * 1_000) / iterations),
    outputBytes: result.byteLength,
  };
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatMicroseconds(value) {
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)} ms` : `${value.toFixed(1)} µs`;
}

function browserSummary(browser) {
  if (!browser?.sizes) return "\nBrowser benchmark has not been recorded yet.\n";

  const lines = [
    "",
    "## Browser warm navigation",
    "",
    "| Fixture | Mode | Total p50 / p95 | Transform/decode p50 / p95 | Commit p50 / p95 |",
    "| --- | --- | ---: | ---: | ---: |",
  ];

  for (const [size, modes] of Object.entries(browser.sizes)) {
    for (const [mode, result] of Object.entries(modes)) {
      lines.push(
        `| ${size} | ${mode} | ${result.totalMs.p50.toFixed(2)} / ${result.totalMs.p95.toFixed(2)} ms | ${result.transformMs.p50.toFixed(2)} / ${result.transformMs.p95.toFixed(2)} ms | ${result.commitMs.p50.toFixed(2)} / ${result.commitMs.p95.toFixed(2)} ms |`,
      );
    }
  }

  lines.push(
    "",
    `Surrounding client shell state preserved: ${browser.surroundingClientStatePreserved ? "yes" : "no"}`,
    "",
    `Cold JavaScript renderer load: ${browser.coldLoads.jsRendererMs.toFixed(2)} ms`,
    "",
    `Cold Rust/Wasm load and instantiation: ${browser.coldLoads.wasmRendererMs.toFixed(2)} ms`,
    "",
  );
  return lines.join("\n");
}

function breakEvenNavigations(assetBytes, recurringBytes, baselineBytes) {
  const saving = baselineBytes - recurringBytes;
  return saving <= 0 ? "never" : String(Math.ceil(assetBytes / saving));
}

function findingsSummary(result) {
  const warmWinners = result.browser
    ? Object.entries(result.browser.sizes)
        .map(([size, modes]) => {
          const [mode] = Object.entries(modes).reduce((winner, candidate) =>
            candidate[1].totalMs.p50 < winner[1].totalMs.p50 ? candidate : winner,
          );
          return `${size}: ${mode}`;
        })
        .join(", ")
    : "not measured";
  const lines = [
    "",
    "## Measured findings",
    "",
    `Plain HTML had the lowest first-navigation transfer for every fixture. Warm browser p50 winners were ${warmWinners}. Within RSC, carrying one opaque HTML fragment beat serializing the equivalent host-element tree.`,
    "",
    "| Fixture | Opaque Flight Brotli reduction | Opaque RSC commit reduction | Strata HTML + wrapper server reduction |",
    "| --- | ---: | ---: | ---: |",
  ];

  for (const [size, fixture] of Object.entries(result.fixtures)) {
    const transferReduction =
      (1 - fixture.payloads.flightHtml.brotli / fixture.payloads.flight.brotli) * 100;
    const strataOpaqueServerUs =
      fixture.server.strata.perIterationUs + fixture.server.flightHtml.perIterationUs;
    const serverReduction = (1 - strataOpaqueServerUs / fixture.server.flight.perIterationUs) * 100;
    const browserModes = result.browser?.sizes?.[size];
    const commitReduction = browserModes
      ? (1 - browserModes["flight-html"].commitMs.p50 / browserModes.flight.commitMs.p50) * 100
      : null;

    lines.push(
      `| ${size} | ${transferReduction.toFixed(1)}% | ${commitReduction === null ? "not measured" : `${commitReduction.toFixed(1)}%`} | ${serverReduction.toFixed(1)}% |`,
    );
  }

  lines.push(
    "",
    "The reusable-renderer break-even below counts Brotli bytes only. A value of 10 means the renderer plus ten IR payloads becomes no larger than ten baseline payloads on navigation 10.",
    "",
    "| Fixture | JS IR vs HTML | JS IR vs opaque Flight | JS IR vs tree Flight | Wasm IR vs HTML | Wasm IR vs opaque Flight | Wasm IR vs tree Flight |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  );

  for (const [size, fixture] of Object.entries(result.fixtures)) {
    const ir = fixture.payloads.ir.brotli;
    const html = fixture.payloads.html.brotli;
    const flightHtml = fixture.payloads.flightHtml.brotli;
    const flight = fixture.payloads.flight.brotli;
    lines.push(
      `| ${size} | ${breakEvenNavigations(result.assets.javascript.brotli, ir, html)} | ${breakEvenNavigations(result.assets.javascript.brotli, ir, flightHtml)} | ${breakEvenNavigations(result.assets.javascript.brotli, ir, flight)} | ${breakEvenNavigations(result.assets.wasm.brotli, ir, html)} | ${breakEvenNavigations(result.assets.wasm.brotli, ir, flightHtml)} | ${breakEvenNavigations(result.assets.wasm.brotli, ir, flight)} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

function createMarkdown(result) {
  const lines = [
    "# RSC transport benchmark",
    "",
    `Generated ${result.generatedAt}.`,
    "",
    "## Transfer size",
    "",
    "| Fixture | Representation | Raw | gzip | Brotli |",
    "| --- | --- | ---: | ---: | ---: |",
  ];

  for (const [size, fixture] of Object.entries(result.fixtures)) {
    for (const representation of ["ir", "html", "flightHtml", "flight"]) {
      const bytes = fixture.payloads[representation];
      lines.push(
        `| ${size} | ${representation} | ${formatBytes(bytes.raw)} | ${formatBytes(bytes.gzip)} | ${formatBytes(bytes.brotli)} |`,
      );
    }
  }

  lines.push(
    "",
    "## Incremental client renderer",
    "",
    "| Renderer | Raw | gzip | Brotli |",
    "| --- | ---: | ---: | ---: |",
    `| JavaScript UI IR | ${formatBytes(result.assets.javascript.raw)} | ${formatBytes(result.assets.javascript.gzip)} | ${formatBytes(result.assets.javascript.brotli)} |`,
    `| Rust/Wasm UI IR | ${formatBytes(result.assets.wasm.raw)} | ${formatBytes(result.assets.wasm.gzip)} | ${formatBytes(result.assets.wasm.brotli)} |`,
    "",
    "## Warm server work",
    "",
    "| Fixture | JavaScript IR → HTML | Strata object → HTML | Strata JSON → HTML | HTML wrapper → Flight | React tree → Flight |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );

  for (const [size, fixture] of Object.entries(result.fixtures)) {
    lines.push(
      `| ${size} | ${formatMicroseconds(fixture.server.javascript.perIterationUs)} | ${formatMicroseconds(fixture.server.strata.perIterationUs)} | ${formatMicroseconds(fixture.server.strataJson.perIterationUs)} | ${formatMicroseconds(fixture.server.flightHtml.perIterationUs)} | ${formatMicroseconds(fixture.server.flight.perIterationUs)} |`,
    );
  }

  lines.push(
    browserSummary(result.browser),
    findingsSummary(result),
    "## Interpretation limits",
    "",
    "The fixture is a host-only content tree. Strata object timing includes JavaScript JSON serialization and its N-API call; Strata JSON timing starts from a pre-serialized typed host tree. Browser endpoints serve precomputed Brotli payloads over loopback to isolate transfer, decode, and commit; server production is measured separately. Flight results do not include Client Component module references, Suspense waterfalls, database work, CDN latency, or initial HTML/Flight duplication. The opaque HTML representation gives up React ownership inside that fragment and therefore cannot contain independently updating Client Components. Browser timings come from one browser and machine. Compare the raw distributions and rerun on target devices before choosing a production transport.",
    "",
  );
  return lines.join("\n");
}

await fs.mkdir(generatedDirectory, { recursive: true });
await fs.mkdir(resultsDirectory, { recursive: true });

console.log("Building Rust/Wasm renderer...");
run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "--lib"], {
  cwd: rustDirectory,
});

console.log("Building browser fixture...");
run(process.execPath, [path.join(benchmarkDirectory, "node_modules/vite/bin/vite.js"), "build"]);
await fs.copyFile(wasmBinary, path.join(benchmarkDirectory, "dist/assets/renderer.wasm"));

const fixtures = {};

for (const [name, definition] of Object.entries(fixtureDefinitions)) {
  console.log(`Benchmarking ${name} fixture...`);
  const document = generateDocument(definition.sections);
  const ir = encodeDocument(document);
  const jsHtml = renderDocumentToHtml(document);
  const strataDocument = createStrataDocument(document);
  const strataJson = JSON.stringify(strataDocument);
  const fixturePath = path.join(generatedDirectory, `${name}.fui`);
  const strataDocumentPath = path.join(generatedDirectory, `${name}.strata.json`);
  const strataHtmlPath = path.join(generatedDirectory, `${name}.strata.html`);
  await fs.writeFile(fixturePath, ir);
  await fs.writeFile(strataDocumentPath, strataJson);

  const strataFragment = renderStrataJson(strataJson);
  await fs.writeFile(strataHtmlPath, strataFragment.html);
  if (strataFragment.html !== normalizeRedundantTextEscapes(jsHtml)) {
    throw new Error(
      `${name}: Strata and JavaScript HTML are not semantically equivalent (${digest(strataFragment.html)} != ${digest(jsHtml)})`,
    );
  }
  const strataHtml = strataFragment.html;

  const decodedHtml = renderIr(ir);
  if (decodedHtml !== jsHtml) {
    throw new Error(`${name}: JavaScript IR decode/render does not match direct rendering`);
  }

  const flight = await renderFlight(document);
  const flightHtml = await renderOpaqueHtmlFlight(strataHtml);
  await fs.writeFile(path.join(generatedDirectory, `${name}.flight`), flight);
  await fs.writeFile(path.join(generatedDirectory, `${name}.flight-html`), flightHtml);
  await fs.writeFile(path.join(generatedDirectory, `${name}.html`), strataHtml);

  const javascriptServer = benchmarkSync(() => renderIr(ir), definition.rendererIterations);
  const strataServer = benchmarkSync(
    () => renderStrata(strataDocument).html,
    definition.rendererIterations,
  );
  const strataJsonServer = benchmarkSync(
    () => renderStrataJson(strataJson).html,
    definition.rendererIterations,
  );
  const flightServer = await benchmarkFlight(
    () => renderFlight(document),
    definition.flightIterations,
  );
  const flightHtmlServer = await benchmarkFlight(
    () => renderOpaqueHtmlFlight(jsHtml),
    definition.flightIterations,
  );

  fixtures[name] = {
    sections: definition.sections,
    blocks: document.blocks.length,
    hashes: {
      html: digest(strataHtml),
      javascriptHtml: digest(jsHtml),
      ir: digest(ir),
      flightHtml: digest(flightHtml),
      flight: digest(flight),
    },
    payloads: {
      ir: byteSizes(ir),
      html: byteSizes(strataHtml),
      flightHtml: byteSizes(flightHtml),
      flight: byteSizes(flight),
    },
    server: {
      javascript: javascriptServer,
      strata: strataServer,
      strataJson: strataJsonServer,
      flightHtml: flightHtmlServer,
      flight: flightServer,
    },
  };
}

const javascriptAsset = await fs.readFile(path.join(benchmarkDirectory, "dist/assets/renderer.js"));
const wasmAsset = await fs.readFile(path.join(benchmarkDirectory, "dist/assets/renderer.wasm"));
let browser;
try {
  browser = JSON.parse(
    await fs.readFile(path.join(generatedDirectory, "browser-results.json"), "utf8"),
  );
} catch {
  browser = null;
}

const result = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  fixtureDefinitions,
  assets: {
    javascript: byteSizes(javascriptAsset),
    wasm: byteSizes(wasmAsset),
  },
  fixtures,
  browser,
};

await fs.writeFile(
  path.join(generatedDirectory, "manifest.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
await fs.writeFile(
  path.join(resultsDirectory, "latest.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
await fs.writeFile(path.join(resultsDirectory, "latest.md"), createMarkdown(result));

console.log("");
console.log(createMarkdown(result));
