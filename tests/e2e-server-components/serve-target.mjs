// Serves the server components example's build for a deploy target on a local port, so the
// contract runs against that platform's output instead of the Node server:
//
//   node tests/e2e-server-components/serve-target.mjs <cloudflare|vercel> <outputDir> <port>
//
// cloudflare: the Pages output in workerd (Miniflare), with the static files as assets.
// vercel: the Build Output API directory: config.json routes, static files, then the function.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const [target, outputArg, portArg] = process.argv.slice(2);
const outputDir = path.resolve(outputArg ?? "");
const port = Number(portArg);
if (!outputArg || !Number.isInteger(port) || (target !== "cloudflare" && target !== "vercel")) {
  throw new Error("usage: serve-target.mjs <cloudflare|vercel> <outputDir> <port>");
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const handle = target === "cloudflare" ? await cloudflare() : await vercel();

// Node's side of the platform: turns each request into a Web Request for `handle` and streams the
// Response back as it comes, every Set-Cookie header kept separate.
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? "/", `http://${incoming.headers.host}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      for (const item of Array.isArray(value) ? value : [value ?? ""]) headers.append(name, item);
    }
    headers.set("x-forwarded-for", incoming.socket.remoteAddress ?? "127.0.0.1");
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", "http");
    const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
    const request = new Request(url, {
      method: incoming.method,
      headers,
      body: hasBody ? Readable.toWeb(incoming) : undefined,
      duplex: "half",
      redirect: "manual",
    });
    const response = await handle(request);
    const raw = [];
    for (const [name, value] of response.headers) {
      if (name !== "set-cookie") raw.push(name, value);
    }
    for (const cookie of response.headers.getSetCookie()) raw.push("set-cookie", cookie);
    outgoing.writeHead(response.status, raw);
    if (!response.body || incoming.method === "HEAD") return outgoing.end();
    Readable.fromWeb(response.body).pipe(outgoing);
  } catch (error) {
    console.error(error);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
});
server.listen(port, "127.0.0.1", () => console.log(`${target} output on http://127.0.0.1:${port}`));
const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function cloudflare() {
  const { Miniflare } = await import("miniflare");
  const workerDirectory = path.join(outputDir, "_worker.js");
  const runtime = new Miniflare({
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    modules: true,
    modulesRoot: workerDirectory,
    scriptPath: path.join(workerDirectory, "index.js"),
    assets: { directory: outputDir, routerConfig: { has_user_worker: true } },
  });
  await runtime.ready;
  process.on("exit", () => void runtime.dispose());
  return (request) => {
    // Miniflare compresses for a client that accepts it and holds the whole body until it ends,
    // which Cloudflare's edge does not. dispatchFetch is undici's fetch, which asks for gzip when a
    // request names no encoding, so ask for identity: the body streams as the worker writes it.
    const headers = new Headers(request.headers);
    headers.set("accept-encoding", "identity");
    return runtime.dispatchFetch(request.url, {
      method: request.method,
      headers,
      body: request.body,
      duplex: "half",
      redirect: "manual",
    });
  };
}

// A route's `src` matches the whole path, case-insensitively unless it says otherwise.
function routeMatches(route, pathname) {
  if (!route.src) return false;
  const source = route.src.replace(/^\^/, "").replace(/\$$/, "");
  return new RegExp(`^(?:${source})$`, route.caseSensitive ? "" : "i").test(pathname);
}

// The file Vercel serves for a path: the file itself, or a directory's index.html.
async function findStatic(staticDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  for (const candidate of [decoded, path.join(decoded, "index.html"), `${decoded}.html`]) {
    const file = path.join(staticDir, candidate);
    if (!file.startsWith(staticDir + path.sep)) continue;
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) return file;
  }
  return null;
}

async function vercel() {
  const config = JSON.parse(await readFile(path.join(outputDir, "config.json"), "utf8"));
  const routes = config.routes ?? [];
  const filesystem = routes.findIndex((route) => route.handle === "filesystem");
  const beforeFilesystem = filesystem < 0 ? routes : routes.slice(0, filesystem);
  const staticDir = path.join(outputDir, "static");
  const functionEntry = path.join(outputDir, "functions/__nitro.func/index.mjs");
  const handler = (await import(pathToFileURL(functionEntry).href)).default;

  return async (request) => {
    const { pathname } = new URL(request.url);
    const headers = [];
    for (const route of beforeFilesystem) {
      if (route.headers && routeMatches(route, pathname)) {
        headers.push(...Object.entries(route.headers));
      }
    }
    let response;
    const file =
      request.method === "GET" || request.method === "HEAD"
        ? await findStatic(staticDir, pathname)
        : null;
    if (file) {
      const type = contentTypes[path.extname(file)] ?? "application/octet-stream";
      response = new Response(Readable.toWeb(createReadStream(file)), {
        headers: { "content-type": type },
      });
    } else {
      // Everything else reaches the function, as the routes after `handle: filesystem` send it.
      response = await handler.fetch(request, { waitUntil() {} });
    }
    for (const [name, value] of headers) response.headers.set(name, value);
    return response;
  };
}
