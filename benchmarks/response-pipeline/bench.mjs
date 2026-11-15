#!/usr/bin/env node
// Response-pipeline micro-benchmark for RFC 0002. Measures server CPU per request
// for sending one buffered page: today's path (a Web Response rebuilt by each
// header step) against the proposal (one FastResponse Farm owns, headers edited
// in place). Both send through srvx's sendNodeResponse, as Nitro's Node server does.
//
//   pnpm --filter @farm.js/core build
//   node benchmarks/response-pipeline/bench.mjs [page.html] [--requests 4000] [--rounds 3]
//
// Without a page argument it uses a generated 8 KB document.
import { fork } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../packages/farm");
const requireFromCore = createRequire(path.join(coreDir, "package.json"));
const srvxNode = createRequire(requireFromCore.resolve("nitro/package.json")).resolve("srvx/node");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(args[index + 1]);
};

if (process.env.BENCH_SERVER_MODE) {
  const { FastResponse, sendNodeResponse } = await import(pathToFileURL(srvxNode).href);
  const { applyMarkdownNegotiationHeaders, resolveMarkdownConfig } = await import(
    pathToFileURL(path.join(coreDir, "dist/markdown.mjs")).href
  );
  const html = process.env.BENCH_HTML_FILE
    ? readFileSync(process.env.BENCH_HTML_FILE, "utf8")
    : `<!DOCTYPE html><html><head><title>Bench</title></head><body><main>${"<li>item</li>".repeat(600)}</main></body></html>`;
  const md = resolveMarkdownConfig(undefined);
  const rebuild = (response, edit) => {
    const headers = new Headers(response.headers);
    edit(headers);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
  // The steps the generated server runs after a page renders today.
  const current = () => {
    let response = new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "x-farm-preload-buffered": "none",
      },
    });
    response = rebuild(response, () => {}); // applyProductionMiddlewareHeaders
    response = rebuild(response, (headers) => headers.delete("x-farm-preload-buffered")); // applyFarmPreloadBudget
    response = applyMarkdownNegotiationHeaders(response, { config: md, pathname: "/" });
    return rebuild(response, (headers) => headers.append("Vary", "Accept-Encoding")); // compression Vary
  };
  // The proposal: one owned response, header steps edit it in place.
  const proposed = () => {
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    });
    headers.append("Vary", "Accept");
    headers.append("Link", '</index.md>; rel="alternate"; type="text/markdown"');
    headers.set("Vary", "Accept, Accept-Encoding");
    return new FastResponse(html, { status: 200, headers });
  };
  const build = process.env.BENCH_SERVER_MODE === "proposed" ? proposed : current;
  const server = http.createServer((req, res) => {
    if (req.url === "/__cpu") {
      const { user, system } = process.cpuUsage();
      res.end(String(user + system));
      return;
    }
    sendNodeResponse(res, build());
  });
  server.listen(0, "127.0.0.1", () => process.send(server.address().port));
} else {
  const requests = option("requests", 4000);
  const rounds = option("rounds", 3);
  const htmlFile = args[0] && !args[0].startsWith("--") ? path.resolve(args[0]) : "";
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const get = (port, pathname = "/") =>
    new Promise((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port, path: pathname, agent }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve(body));
        })
        .on("error", reject);
    });
  const results = { current: [], proposed: [] };
  for (let round = 0; round < rounds; round++) {
    for (const mode of ["current", "proposed"]) {
      const child = fork(fileURLToPath(import.meta.url), [], {
        env: { ...process.env, BENCH_SERVER_MODE: mode, BENCH_HTML_FILE: htmlFile },
      });
      const port = await new Promise((resolve) => child.once("message", resolve));
      for (let i = 0; i < 300; i++) await get(port);
      const before = Number(await get(port, "/__cpu"));
      for (let i = 0; i < requests; i++) await get(port);
      const after = Number(await get(port, "/__cpu"));
      results[mode].push((after - before) / requests);
      child.kill();
    }
  }
  agent.destroy();
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  for (const mode of ["current", "proposed"]) {
    console.log(
      `${mode.padEnd(9)} server CPU per request: median ${median(results[mode]).toFixed(1)} us (${results[mode].map((v) => v.toFixed(1)).join(", ")})`,
    );
  }
}
