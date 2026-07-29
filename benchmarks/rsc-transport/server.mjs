import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import React from "react";
import { renderToPipeableStream } from "react-server-dom-webpack/server.node";
import { encodeDocument, generateDocument } from "./src/document.mjs";
import { renderDocumentToHtml } from "./src/render-js.mjs";
import { RscDocument, RscOpaqueHtmlDocument } from "./src/rsc-tree.mjs";

const benchmarkDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.join(benchmarkDirectory, "dist");
const generatedDirectory = path.join(benchmarkDirectory, "generated");
const port = Number(process.env.PORT || 4179);
const fixtureSections = {
  small: 6,
  medium: 24,
  large: 96,
};
const variants = new Map();
const staticBrotli = new Map();

for (const [size, sections] of Object.entries(fixtureSections)) {
  for (let variant = 0; variant < 6; variant += 1) {
    const document = generateDocument(sections, variant);
    variants.set(`${size}:${variant}`, {
      document,
      html: Buffer.from(renderDocumentToHtml(document)),
      ir: Buffer.from(encodeDocument(document)),
    });
  }
}

function renderFlight(model) {
  return new Promise((resolve, reject) => {
    const destination = new PassThrough();
    const chunks = [];
    destination.on("data", (chunk) => chunks.push(chunk));
    destination.on("error", reject);
    destination.on("end", () => resolve(Buffer.concat(chunks)));
    renderToPipeableStream(model, {}, { onError: reject }).pipe(destination);
  });
}

function compress(body) {
  return brotliCompressSync(body, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  });
}

for (const fixture of variants.values()) {
  fixture.flight = await renderFlight(
    React.createElement(RscDocument, { document: fixture.document }),
  );
  fixture.flightHtml = await renderFlight(
    React.createElement(RscOpaqueHtmlDocument, {
      html: fixture.html.toString("utf8"),
    }),
  );

  for (const representation of ["html", "ir", "flight", "flightHtml"]) {
    fixture[`${representation}Brotli`] = compress(fixture[representation]);
  }
}

async function precompressStaticDirectory(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await precompressStaticDirectory(filePath);
    } else {
      staticBrotli.set(filePath, compress(await fs.readFile(filePath)));
    }
  }
}

await precompressStaticDirectory(distDirectory);

function send(response, status, contentType, body, duration, extraHeaders = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": body.byteLength,
    "Content-Type": contentType,
    ...(duration === undefined
      ? {}
      : {
          "Server-Timing": `produce;dur=${duration.toFixed(3)}`,
          "X-Produce-Duration-Ms": duration.toFixed(3),
        }),
    ...extraHeaders,
  });
  response.end(body);
}

function sendRepresentation(request, response, contentTypeValue, fixture, key, duration) {
  const useBrotli = request.headers["accept-encoding"]?.includes("br");
  const body = useBrotli ? fixture[`${key}Brotli`] : fixture[key];
  send(response, 200, contentTypeValue, body, duration, {
    Vary: "Accept-Encoding",
    "X-Uncompressed-Content-Length": fixture[key].byteLength,
    ...(useBrotli ? { "Content-Encoding": "br" } : {}),
  });
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      send(response, 200, "text/plain; charset=utf-8", Buffer.from("ok"));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/browser-results") {
      const body = await readRequestBody(request);
      JSON.parse(body.toString("utf8"));
      await fs.mkdir(generatedDirectory, { recursive: true });
      await fs.writeFile(path.join(generatedDirectory, "browser-results.json"), body);
      send(response, 204, "text/plain; charset=utf-8", Buffer.alloc(0));
      return;
    }

    const match = url.pathname.match(/^\/api\/(flight-html|flight|html|ir)\/(small|medium|large)$/);
    if (request.method === "GET" && match) {
      const [, mode, size] = match;
      const variantNumber = Number(url.searchParams.get("variant") || 0);
      const variant = Number.isFinite(variantNumber) ? Math.abs(Math.trunc(variantNumber)) % 6 : 0;
      const fixture = variants.get(`${size}:${variant}`);
      const start = performance.now();

      if (mode === "flight" || mode === "flight-html") {
        sendRepresentation(
          request,
          response,
          "text/x-component; charset=utf-8",
          fixture,
          mode === "flight" ? "flight" : "flightHtml",
          performance.now() - start,
        );
        return;
      }

      if (mode === "html") {
        sendRepresentation(
          request,
          response,
          "text/html; charset=utf-8",
          fixture,
          "html",
          performance.now() - start,
        );
        return;
      }

      sendRepresentation(
        request,
        response,
        "application/vnd.farm.ui-ir",
        fixture,
        "ir",
        performance.now() - start,
      );
      return;
    }

    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.resolve(distDirectory, `.${requestedPath}`);
    if (!filePath.startsWith(`${distDirectory}${path.sep}`)) {
      send(response, 403, "text/plain; charset=utf-8", Buffer.from("forbidden"));
      return;
    }

    try {
      const body = await fs.readFile(filePath);
      const useBrotli = request.headers["accept-encoding"]?.includes("br");
      let responseBody = body;
      if (useBrotli) {
        responseBody = staticBrotli.get(filePath);
        if (!responseBody) {
          responseBody = compress(body);
          staticBrotli.set(filePath, responseBody);
        }
      }
      send(response, 200, contentType(filePath), responseBody, undefined, {
        Vary: "Accept-Encoding",
        ...(useBrotli ? { "Content-Encoding": "br" } : {}),
      });
    } catch (error) {
      if (error.code === "ENOENT") {
        send(response, 404, "text/plain; charset=utf-8", Buffer.from("not found"));
        return;
      }
      throw error;
    }
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      send(response, 500, "text/plain; charset=utf-8", Buffer.from("internal error"));
    } else {
      response.destroy(error);
    }
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`RSC transport benchmark listening on http://127.0.0.1:${port}`);
});
