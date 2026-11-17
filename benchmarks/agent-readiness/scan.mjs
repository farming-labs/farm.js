// Agent-readiness scan: what does a site send an AI agent?
// Usage: node scan.mjs [out.json]
import { writeFileSync } from "node:fs";
import { SITES } from "./sites.mjs";

const UA = "Mozilla/5.0 (compatible; agent-readiness-check/0.1)";
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 30 * 1024 * 1024;
const CONCURRENCY = 4;

async function get(url, opts = {}) {
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await getOnce(url, opts);
    if (r.status !== 0) return { ...r, attempts: attempt + 1 };
  }
  return { ...r, attempts: 3 };
}

async function getOnce(
  url,
  { accept = "*/*", method = "GET", body, headers = {}, maxBytes = MAX_BYTES } = {},
) {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      ...(body === undefined ? {} : { body }),
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": UA, accept, ...headers },
    });
    let bytes = 0;
    let capped = false;
    let head = "";
    const decoder = new TextDecoder();
    if (res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (head.length < 4096) head += decoder.decode(value, { stream: true });
        // An MCP server may hold an event stream open after its first answer.
        if (method === "POST" && head.includes('"jsonrpc"')) {
          await reader.cancel();
          break;
        }
        if (bytes > maxBytes) {
          capped = true;
          await reader.cancel();
          break;
        }
      }
    }
    return {
      url,
      finalUrl: res.url,
      status: res.status,
      type: res.headers.get("content-type") ?? "",
      vary: res.headers.get("vary") ?? "",
      auth: res.headers.get("www-authenticate") ?? "",
      cfMitigated: res.headers.get("cf-mitigated") ?? "",
      bytes,
      capped,
      contentLength: Number(res.headers.get("content-length") ?? 0) || null,
      head,
      ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      url,
      status: 0,
      error: String(error?.cause?.code ?? error?.name ?? error),
      bytes: 0,
      head: "",
      type: "",
    };
  } finally {
    clearTimeout(timer);
  }
}

const looksHtml = (r) => /^\s*(<!doctype|<html|<head|<body|<\?xml|<)/i.test(r.head);
const isText = (r) =>
  r.status === 200 && r.bytes > 200 && !looksHtml(r) && /markdown|text\/plain/i.test(r.type);
const isMarkdownAnswer = (r) => isText(r);
const isLlmsTxt = (r) => r.status === 200 && r.bytes > 0 && !looksHtml(r) && !/json/i.test(r.type);
const blocked = (r) => r.status === 403 || r.status === 429 || Boolean(r.cfMitigated);

function mdSuffix(url) {
  const u = new URL(url);
  const path = u.pathname.replace(/\/$/, "");
  u.pathname = path === "" ? "/index.md" : `${path.replace(/\.html$/, "")}.md`;
  return u.toString();
}

const INIT = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "agent-readiness-check", version: "0.1.0" },
  },
});

async function mcp(origin) {
  const r = await get(`${origin}/mcp`, {
    method: "POST",
    body: INIT,
    accept: "application/json, text/event-stream",
    headers: { "content-type": "application/json" },
  });
  const answered = /"jsonrpc"/.test(r.head) && /"result"|serverInfo/.test(r.head);
  const needsAuth = r.status === 401 && /bearer|resource_metadata/i.test(r.auth);
  return { status: r.status, answered, needsAuth, finalUrl: r.finalUrl, error: r.error };
}

function slim(r, extra = {}) {
  return {
    status: r.status,
    type: r.type,
    bytes: r.bytes,
    capped: r.capped,
    contentLength: r.contentLength,
    attempts: r.attempts,
    finalUrl: r.finalUrl,
    vary: r.vary,
    error: r.error,
    blocked: blocked(r),
    ...extra,
  };
}

async function scanSite([category, name, home, docs]) {
  const homeOrigin = new URL(home).origin;
  const docsOrigin = new URL(docs).origin;
  const origins = [...new Set([homeOrigin, docsOrigin])];

  const [homeHtml, homeMd, docsHtml, docsMd, docsSuffix] = await Promise.all([
    get(home, { accept: "text/html" }),
    get(home, { accept: "text/markdown" }),
    get(docs, { accept: "text/html" }),
    get(docs, { accept: "text/markdown" }),
    get(mdSuffix(docs), { accept: "*/*" }),
  ]);

  const perOrigin = {};
  for (const origin of origins) {
    const [llms, llmsFull, mcpResult, catalog] = await Promise.all([
      get(`${origin}/llms.txt`),
      get(`${origin}/llms-full.txt`, { maxBytes: 512 * 1024 }),
      mcp(origin),
      get(`${origin}/.well-known/api-catalog`, {
        accept: "application/linkset+json, application/json",
      }),
    ]);
    perOrigin[origin] = {
      llmsTxt: slim(llms, { ok: isLlmsTxt(llms) }),
      llmsFullTxt: slim(llmsFull, { ok: isLlmsTxt(llmsFull) }),
      mcp: mcpResult,
      apiCatalog: slim(catalog, { ok: catalog.status === 200 && /json/i.test(catalog.type) }),
    };
  }

  const any = (key) =>
    Object.values(perOrigin).some((o) =>
      key === "mcp" ? o.mcp.answered || o.mcp.needsAuth : o[key].ok,
    );
  const best = (key) =>
    Math.max(
      0,
      ...Object.values(perOrigin)
        .filter((o) => o[key].ok)
        .map((o) => o[key].bytes),
    );

  return {
    category,
    name,
    home,
    docs,
    homeHtml: slim(homeHtml, { jsonLd: /application\/ld\+json/i.test(homeHtml.head) }),
    homeMarkdown: slim(homeMd, { ok: isMarkdownAnswer(homeMd) }),
    docsHtml: slim(docsHtml),
    docsMarkdown: slim(docsMd, { ok: isMarkdownAnswer(docsMd) }),
    docsMdSuffix: slim(docsSuffix, {
      ok:
        isText(docsSuffix) ||
        (docsSuffix.status === 200 && !looksHtml(docsSuffix) && docsSuffix.bytes > 200),
    }),
    perOrigin,
    summary: {
      homeMarkdown: isMarkdownAnswer(homeMd),
      docsMarkdown: isMarkdownAnswer(docsMd),
      docsMdSuffix: docsSuffix.status === 200 && !looksHtml(docsSuffix) && docsSuffix.bytes > 200,
      llmsTxt: any("llmsTxt"),
      llmsTxtBytes: best("llmsTxt"),
      llmsFullTxt: any("llmsFullTxt"),
      llmsFullTxtBytes: best("llmsFullTxt"),
      mcp: any("mcp"),
      apiCatalog: any("apiCatalog"),
      blocked: blocked(homeHtml) || blocked(docsHtml),
    },
  };
}

const results = [];
let next = 0;
async function worker() {
  while (next < SITES.length) {
    const site = SITES[next++];
    const r = await scanSite(site);
    results.push(r);
    const s = r.summary;
    console.error(
      `${r.name.padEnd(16)} homeMd=${s.homeMarkdown ? "Y" : "-"} docsMd=${s.docsMarkdown ? "Y" : "-"} .md=${s.docsMdSuffix ? "Y" : "-"} llms=${s.llmsTxt ? "Y" : "-"} full=${s.llmsFullTxt ? "Y" : "-"} mcp=${s.mcp ? "Y" : "-"} home=${r.homeHtml.status}/${r.homeHtml.bytes} docs=${r.docsHtml.status}/${r.docsHtml.bytes}${s.blocked ? " BLOCKED" : ""}`,
    );
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
results.sort(
  (a, b) => SITES.findIndex((s) => s[1] === a.name) - SITES.findIndex((s) => s[1] === b.name),
);
const out = process.argv[2] ?? "results.json";
writeFileSync(
  out,
  JSON.stringify({ scannedAt: new Date().toISOString(), userAgent: UA, results }, null, 2),
);
console.error(`wrote ${out} (${results.length} sites)`);
