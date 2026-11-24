// A cold visit to a page whose client components all hydrate with it (app/src/app/dash), over an
// emulated mobile network: what an engine's client runtime costs where every component needs it
// (RFC 0013).
//
//   node benchmarks/server-components-payload/hydration.mjs [--modes rsc,islands]
//     [--latency 150] [--down <kbit/s>] [--cpu 4] [--rounds 11]
//
// Uses the production builds measure.mjs leaves in app/.farm; a mode names a build directory
// (`.output-<mode>`), so a copy of one (`.output-islands-before`) can run beside it. Each round
// visits /dash/p0 once per mode, in alternating order, in a new browser context, after one visit
// per mode that warms the servers:
//
// - the network adds `--latency` ms to every response, downloads at `--down` kbit/s (unlimited by
//   default), and Chrome runs with `--cpu`x throttling;
// - the time runs from the navigation's start to the moment the last of the page's 24 components
//   has hydrated (its effect has run); first contentful paint and the script bytes the browser
//   received are reported beside it.
//
// Responses go over HTTP/2 through a local TLS proxy, as in first-navigation.mjs. The proxy
// compresses every script with brotli at quality 11, as a CDN serving precompressed assets does,
// so the engines compare at equal compression: the `rsc` engine's Node server sends gzip, the
// `islands` one brotli. Pages and other text get brotli quality 5 with a flush per chunk.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, createBrotliCompress } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../..");
const app = path.join(here, "app");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repositoryRoot, "node_modules", "@playwright", "test"));

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const modes = option("--modes", "rsc,islands").split(",");
const rounds = Number(option("--rounds", "11"));
const latency = Number(option("--latency", "150"));
const down = args.includes("--down") ? Number(option("--down", "0")) : null;
const cpu = Number(option("--cpu", "4"));
const PAGE = "/dash/p0";
const COMPONENTS = 24;

async function serve(mode, port) {
  const child = spawn(
    process.execPath,
    [path.join(app, ".farm", `.output-${mode}`, "server", "index.mjs")],
    {
      cwd: app,
      env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port) },
      stdio: "ignore",
    },
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}${PAGE}`)).ok) return () => child.kill();
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`${mode} server did not start`);
}

/** An HTTP/2 TLS proxy on `port` in front of the server on `upstream`. Returns its close. */
async function proxy(port, upstream, credentials) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
  const hopByHop = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host"]);
  // Each script once: compressing at quality 11 takes longer than a request should.
  const scripts = new Map();
  const server = http2.createSecureServer(credentials, (request, response) => {
    const headers = { host: `127.0.0.1:${upstream}` };
    for (const [name, value] of Object.entries(request.headers)) {
      // Uncompressed from the server, so the proxy compresses both engines' responses alike.
      if (!name.startsWith(":") && !hopByHop.has(name) && name !== "accept-encoding") {
        headers[name] = value;
      }
    }
    const forwarded = http.request(
      {
        host: "127.0.0.1",
        port: upstream,
        method: request.method,
        path: request.url,
        headers,
        agent,
      },
      (answer) => {
        const out = {};
        for (const [name, value] of Object.entries(answer.headers)) {
          if (!hopByHop.has(name)) out[name] = value;
        }
        const brotli = /\bbr\b/.test(request.headers["accept-encoding"] ?? "");
        const type = answer.headers["content-type"] ?? "";
        if (brotli && answer.statusCode === 200 && /javascript/.test(type)) {
          const chunks = [];
          answer.on("data", (chunk) => chunks.push(chunk));
          answer.on("end", () => {
            if (!scripts.has(request.url)) {
              scripts.set(
                request.url,
                brotliCompressSync(Buffer.concat(chunks), {
                  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
                }),
              );
            }
            const body = scripts.get(request.url);
            out["content-encoding"] = "br";
            out["content-length"] = String(body.length);
            response.writeHead(answer.statusCode, out);
            response.end(body);
          });
          return;
        }
        if (!brotli || !type.startsWith("text/")) {
          response.writeHead(answer.statusCode, out);
          answer.pipe(response);
          return;
        }
        // Quality 5 and a flush per chunk, as Farm's own compression, so a stream still streams.
        delete out["content-length"];
        out["content-encoding"] = "br";
        response.writeHead(answer.statusCode, out);
        answer
          .pipe(
            createBrotliCompress({
              flush: constants.BROTLI_OPERATION_FLUSH,
              params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
            }),
          )
          .pipe(response);
      },
    );
    forwarded.on("error", () => response.destroy());
    request.pipe(forwarded);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return () => {
    server.close();
    agent.destroy();
  };
}

/** One cold visit: when every component had hydrated, first contentful paint, script bytes. */
async function visit(browser, origin) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency,
      downloadThroughput: down === null ? -1 : (down * 1000) / 8,
      uploadThroughput: -1,
    });
    const scripts = new Set();
    let scriptBytes = 0;
    cdp.on("Network.responseReceived", (event) => {
      if (event.type === "Script") scripts.add(event.requestId);
    });
    cdp.on("Network.loadingFinished", (event) => {
      if (scripts.has(event.requestId)) scriptBytes += event.encodedDataLength;
    });
    // A component's button reads "Live" once its effect has run.
    await page.addInitScript((count) => {
      const observer = new MutationObserver(() => {
        const live = [...document.querySelectorAll("[data-widget] button")].filter((button) =>
          button.textContent.startsWith("Live"),
        ).length;
        if (live < count) return;
        observer.disconnect();
        window.__hydratedAt = performance.now();
      });
      observer.observe(document, { subtree: true, childList: true, characterData: true });
    }, COMPONENTS);
    await page.goto(`${origin}${PAGE}`, { waitUntil: "load" });
    await page
      .waitForFunction(() => window.__hydratedAt, null, { timeout: 20_000 })
      .catch(() => {
        throw new Error(
          `${origin}${PAGE} did not hydrate: ${errors.join(" | ") || "no page error"}`,
        );
      });
    await page.waitForLoadState("networkidle");
    const { hydrated, paint } = await page.evaluate(() => ({
      hydrated: window.__hydratedAt,
      paint: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
    }));
    return { hydrated: Math.round(hydrated), paint: Math.round(paint), scriptBytes };
  } finally {
    await context.close();
  }
}

const stops = [];
let certificates;
try {
  certificates = mkdtempSync(path.join(tmpdir(), "farm-hydration-"));
  const key = path.join(certificates, "key.pem");
  const cert = path.join(certificates, "cert.pem");
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert].concat([
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
    ]),
    { stdio: "ignore" },
  );
  const credentials = { key: readFileSync(key), cert: readFileSync(cert) };
  const origins = {};
  for (const [index, mode] of modes.entries()) {
    const port = 4491 + index;
    stops.push(await serve(mode, port));
    stops.push(await proxy(port + 100, port, credentials));
    origins[mode] = `https://127.0.0.1:${port + 100}`;
  }
  const browser = await chromium.launch({ channel: "chrome" });
  stops.push(() => browser.close());
  for (const mode of modes) await visit(browser, origins[mode]);
  const samples = {};
  for (let round = 0; round < rounds; round++) {
    for (const mode of round % 2 ? [...modes].reverse() : modes) {
      (samples[mode] ??= []).push(await visit(browser, origins[mode]));
    }
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(
    `Medians of ${rounds}; ${latency} ms latency, ${down === null ? "unlimited" : `${down} kbit/s`} down, HTTP/2, ${cpu}x CPU throttling.`,
  );
  console.table(
    Object.entries(samples).map(([mode, visits]) => ({
      mode,
      "all hydrated (ms)": median(visits.map((sample) => sample.hydrated)),
      "first contentful paint (ms)": median(visits.map((sample) => sample.paint)),
      "script bytes": median(visits.map((sample) => sample.scriptBytes)),
      samples: visits.map((sample) => sample.hydrated).join(" "),
    })),
  );
} finally {
  for (const stop of stops.reverse()) await stop();
  if (certificates) rmSync(certificates, { recursive: true, force: true });
}
