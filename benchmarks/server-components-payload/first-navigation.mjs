// The first client navigation after a cold visit, over an emulated mobile network: the round trips
// a navigation waits for, which a server on localhost hides (RFC 0003).
//
//   node benchmarks/server-components-payload/first-navigation.mjs [--modes rsc,islands]
//     [--latency 50] [--cpu 4] [--hover 100 | --tap | --tap-hold 80] [--rounds 5] [--http1]
//
// Uses the production builds measure.mjs leaves in app/.farm; a mode names a build directory
// (`.output-<mode>`), so a copy of one (`.output-islands-before`) can run beside it. Each round
// visits every section once per mode, in alternating order, in a new browser context:
//
// - the network adds `--latency` ms to every response, and Chrome runs with `--cpu`x throttling;
// - the pointer rests on "Next" for `--hover` ms and clicks, or a finger taps it at once (`--tap`)
//   or after `--tap-hold` ms (a tap usually lasts 50 to 120 ms);
// - the time runs from the click's own timestamp, when the browser received the input (a page
//   busy starting its runtime dispatches it later), to the second frame after the new page's
//   heading is in the document.
//
// Responses go over HTTP/2, as from a CDN, through a local TLS proxy with a self-signed certificate
// (made with `openssl`): over HTTP/1.1 Chrome opens at most six connections to a host, which
// delays a page's seventh module by a round trip. `--http1` serves the builds directly.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../..");
const app = path.join(here, "app");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repositoryRoot, "node_modules", "@playwright", "test"));

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const modes = option("--modes", "rsc,islands").split(",");
const sections = option("--sections", "docs,shop,blog,guide").split(",");
const rounds = Number(option("--rounds", "5"));
const latency = Number(option("--latency", "50"));
const cpu = Number(option("--cpu", "4"));
const hover = Number(option("--hover", "100"));
const tapHold = args.includes("--tap-hold") ? Number(option("--tap-hold", "80")) : null;
const tap = args.includes("--tap") || tapHold !== null;
const http1 = args.includes("--http1");
const FIRST_PAGES = { docs: "/docs/p", shop: "/shop/s", blog: "/blog/b", guide: "/guide/b" };

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
      if ((await fetch(`http://127.0.0.1:${port}/docs/p0`)).ok) return () => child.kill();
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
  const server = http2.createSecureServer(credentials, (request, response) => {
    const headers = { host: `127.0.0.1:${upstream}` };
    for (const [name, value] of Object.entries(request.headers)) {
      if (!name.startsWith(":") && !hopByHop.has(name)) headers[name] = value;
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
        response.writeHead(answer.statusCode, out);
        answer.pipe(response);
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

/** Milliseconds from the click to the new page painted, for one cold visit. */
async function firstNavigation(browser, origin, section) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    hasTouch: tap,
    isMobile: tap,
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    const first = FIRST_PAGES[section];
    await page.goto(`${origin}${first}0`, { waitUntil: "networkidle" });
    // A tap needs the link on screen; whatever scrolling starts settles in the next second.
    if (tap) await page.locator("[data-next]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    // The next page's heading, read from its server directly, outside the emulated network.
    const heading = /<h1>([^<]*)<\/h1>/.exec(
      await (await fetch(`http://127.0.0.1:${upstreams[origin]}${first}1`)).text(),
    )?.[1];
    const painted = page.evaluate(
      (title) =>
        new Promise((resolve) => {
          let clickedAt = 0;
          document.addEventListener("click", (event) => (clickedAt = event.timeStamp), {
            capture: true,
            once: true,
          });
          const observer = new MutationObserver(() => {
            if (document.querySelector("h1")?.textContent !== title) return;
            observer.disconnect();
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now() - clickedAt)),
            );
          });
          observer.observe(document, { subtree: true, childList: true, characterData: true });
        }),
      heading,
    );
    if (tapHold !== null) {
      const box = await page.locator("[data-next]").boundingBox();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await new Promise((resolve) => setTimeout(resolve, tapHold));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else if (tap) {
      await page.tap("[data-next]");
    } else {
      await page.hover("[data-next]");
      await page.waitForTimeout(hover);
      await page.click("[data-next]");
    }
    return Math.round(await painted);
  } finally {
    await context.close();
  }
}

/** The port of the server behind each origin. */
const upstreams = {};
const stops = [];
let certificates;
try {
  const origins = {};
  let credentials;
  if (!http1) {
    certificates = mkdtempSync(path.join(tmpdir(), "farm-first-navigation-"));
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
    credentials = { key: readFileSync(key), cert: readFileSync(cert) };
  }
  for (const [index, mode] of modes.entries()) {
    const port = 4481 + index;
    stops.push(await serve(mode, port));
    if (http1) {
      origins[mode] = `http://127.0.0.1:${port}`;
    } else {
      stops.push(await proxy(port + 100, port, credentials));
      origins[mode] = `https://127.0.0.1:${port + 100}`;
    }
    upstreams[origins[mode]] = port;
  }
  const browser = await chromium.launch({ channel: "chrome" });
  stops.push(() => browser.close());
  const samples = {};
  for (let round = 0; round < rounds; round++) {
    for (const section of sections) {
      for (const mode of round % 2 ? [...modes].reverse() : modes) {
        (samples[`${section} ${mode}`] ??= []).push(
          await firstNavigation(browser, origins[mode], section),
        );
      }
    }
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const rows = Object.entries(samples).map(([key, values]) => {
    const [section, mode] = key.split(" ");
    return { section, mode, "first navigation (ms)": median(values), samples: values.join(" ") };
  });
  const input =
    tapHold !== null
      ? `a tap held ${tapHold} ms`
      : tap
        ? "a tap"
        : `a ${hover} ms hover, then a click`;
  console.log(
    `Medians of ${rounds}; ${latency} ms latency, ${http1 ? "HTTP/1.1" : "HTTP/2"}, ${cpu}x CPU throttling; ${input}.`,
  );
  console.table(rows);
} finally {
  for (const stop of stops.reverse()) await stop();
  if (certificates) rmSync(certificates, { recursive: true, force: true });
}
