import { performance } from "node:perf_hooks";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createBrotliDecompress } from "node:zlib";
import { parse } from "parse5";

export const marker = "framework-benchmark-v1";

function attribute(node, name) {
  return node.attrs?.find((entry) => entry.name === name)?.value;
}

function elements(node) {
  return (node.childNodes ?? []).filter((child) => child.tagName);
}

function hasOnlyElementContent(node) {
  return (node.childNodes ?? []).every(
    (child) =>
      child.tagName ||
      child.nodeName === "#comment" ||
      (child.nodeName === "#text" && !child.value.trim()),
  );
}

function text(node) {
  let value = "";
  for (const child of node.childNodes ?? []) {
    if (child.nodeName === "#text") value += child.value;
    else if (child.nodeName !== "#comment") return null;
  }
  return value.trim();
}

function renderedFixtureTimestamp(body) {
  const roots = [];
  const pending = [parse(body)];
  while (pending.length) {
    const node = pending.pop();
    if (attribute(node, "data-benchmark-marker") === marker) roots.push(node);
    // Template contents are inert and intentionally not traversed. Script and
    // comment text never becomes elements in the parsed HTML tree.
    pending.push(...(node.childNodes ?? []));
  }
  if (roots.length !== 1) return null;
  const root = roots[0];
  if (root.tagName !== "main" || attribute(root, "data-item-count") !== "120") return null;
  const rawTimestamp = attribute(root, "data-rendered-at");
  if (!/^[1-9]\d*$/.test(rawTimestamp ?? "")) return null;
  const timestamp = Number(rawTimestamp);
  if (!Number.isSafeInteger(timestamp)) return null;

  const lists = elements(root).filter((node) => node.tagName === "ul");
  if (lists.length !== 1 || !hasOnlyElementContent(lists[0])) return null;
  const rows = elements(lists[0]);
  if (rows.length !== 120) return null;
  for (const [index, row] of rows.entries()) {
    const children = elements(row);
    if (row.tagName !== "li" || children.length !== 2 || !hasOnlyElementContent(row)) return null;
    const [id, label] = children;
    if (
      id.tagName !== "span" ||
      label.tagName !== "strong" ||
      text(id) !== String(index + 1) ||
      text(label) !== `Benchmark item ${String(index + 1).padStart(3, "0")}`
    )
      return null;
  }
  return timestamp;
}

export const responseEncodings = ["identity", "gzip", "br"];

export async function requestPage(url, timeoutMs = 60000, encoding = "identity") {
  if (!responseEncodings.includes(encoding))
    throw new Error("Unsupported request encoding: " + encoding);
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:")
    throw new Error("Expected an HTTP fixture URL");
  const signal = AbortSignal.timeout(timeoutMs);
  const rethrowRequestError = (error) => {
    throw signal.aborted ? signal.reason : error;
  };
  // All fixture servers run on this host and stamp each render with Date.now().
  // Keep wall-clock controls outside the monotonic response-duration timer.
  const requestedAt = Date.now();
  const startedAt = performance.now();
  // Fetch transparently decompresses the body. Read HTTP body chunks instead so
  // encoded bytes describe this very request, without trusting Content-Length.
  const response = await new Promise((resolve, reject) => {
    const request = (target.protocol === "https:" ? httpsGet : httpGet)(
      target,
      {
        agent: false,
        headers: {
          connection: "close",
          "cache-control": "no-cache",
          pragma: "no-cache",
          "accept-encoding": encoding,
        },
        signal,
      },
      resolve,
    );
    request.on("error", reject);
  }).catch(rethrowRequestError);
  const contentEncoding = (response.headers["content-encoding"] || "identity").trim().toLowerCase();
  if (contentEncoding !== "identity" && contentEncoding !== encoding) {
    response.destroy();
    throw new Error("Unexpected response encoding: " + contentEncoding);
  }
  let encodedBodyBytes = 0;
  let decodedBodyBytes = 0;
  const chunks = [];
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      encodedBodyBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const decoder =
    contentEncoding === "gzip"
      ? createGunzip()
      : contentEncoding === "br"
        ? createBrotliDecompress()
        : null;
  await pipeline(
    response,
    counter,
    ...(decoder ? [decoder] : []),
    async (source) => {
      for await (const chunk of source) {
        decodedBodyBytes += chunk.length;
        chunks.push(chunk);
      }
    },
    { signal },
  ).catch(rethrowRequestError);
  const body = new TextDecoder().decode(Buffer.concat(chunks, decodedBodyBytes));
  // Stop both response and first-page clocks before parsing/validation. The
  // benchmark measures the server and full-body transfer, not this client work.
  const completedAt = performance.now();
  const receivedAt = Date.now();
  return {
    body,
    bytes: decodedBodyBytes,
    encodedBodyBytes,
    decodedBodyBytes,
    contentEncoding,
    durationMs: completedAt - startedAt,
    completedAt,
    requestedAt,
    receivedAt,
    renderedAt: renderedFixtureTimestamp(body),
    status: response.statusCode,
  };
}

export function isValidFixtureResponse(response) {
  return (
    response.status === 200 && Number.isSafeInteger(response.renderedAt) && response.renderedAt > 0
  );
}

export function isFreshFixtureResponse(response) {
  return (
    isValidFixtureResponse(response) &&
    Number.isSafeInteger(response.requestedAt) &&
    Number.isSafeInteger(response.receivedAt) &&
    response.renderedAt >= response.requestedAt &&
    response.renderedAt <= response.receivedAt
  );
}

export async function measureRequests(
  url,
  warmups,
  count,
  { encoding = "identity", onResponse } = {},
) {
  for (let index = 0; index < warmups; index += 1) {
    const response = await requestPage(url, 60000, encoding);
    if (!isFreshFixtureResponse(response)) {
      throw new Error("Fixture validation or freshness check failed during warm-up");
    }
    onResponse?.(response, "warmup");
  }

  const samples = [];
  for (let index = 0; index < count; index += 1) {
    const response = await requestPage(url, 60000, encoding);
    if (!isFreshFixtureResponse(response)) {
      throw new Error("Fixture validation or freshness check failed during measured request");
    }
    onResponse?.(response, "measured");
    samples.push(response.durationMs);
  }
  return samples;
}
