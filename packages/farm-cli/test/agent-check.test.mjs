import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { formatFarmAgentCheckReport, runFarmAgentCheck } = require("../dist/index.js");
const execFileAsync = promisify(execFile);
const cliBin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/farm.js");

const html = (body, headers = {}) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const markdown = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/markdown; charset=utf-8", ...headers },
  });
const text = (body) =>
  new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
const notFound = () =>
  new Response("<h1>Not found</h1>", {
    status: 404,
    headers: { "content-type": "text/html" },
  });

const prose = "Acme bills small teams by usage, with invoices agents can read. ".repeat(10);
const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Acme",
  contactPoint: { "@type": "ContactPoint", contactType: "support", email: "hi@acme.test" },
  address: { "@type": "PostalAddress", addressLocality: "Berlin", addressCountry: "DE" },
};
const page = `<!doctype html><html lang="en"><head><title>Acme</title>
<meta name="description" content="Billing for small teams.">
<link rel="canonical" href="https://acme.test/">
<link rel="alternate" type="text/markdown" href="/index.md">
<script type="application/ld+json">${JSON.stringify(organization)}</script></head>
<body><main><h1>Acme</h1><h2>Pricing</h2><p>${prose}</p></main>
<footer><a href="/company">About us</a><a href="https://legal.acme.test/privacy-policy">Privacy</a></footer></body></html>`;
const article = (title) =>
  `<!doctype html><html><body><main><h1>${title}</h1><p>${prose}</p></main></body></html>`;

/** A complete Farm app, served under `base`. */
function completeApp(base = "") {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const accept = new Headers(init.headers).get("accept") ?? "";
    const route = url.pathname.startsWith(base)
      ? url.pathname.slice(base.length) || "/"
      : url.pathname;
    const etag = { etag: 'W/"abc"' };
    switch (`${init.method ?? "GET"} ${route}${url.search}`) {
      case "GET /":
        return accept.includes("text/markdown")
          ? markdown("# Acme\n", 200, { vary: "Accept" })
          : html(page, { link: `<${base}/index.md>; rel="alternate"; type="text/markdown"` });
      case "GET /index.md":
        return markdown("# Acme\n\nBilling.\n", 200, etag);
      case "GET /index.md?outline":
        return markdown("# Outline of /index.md\n");
      case "GET /index.md?max_tokens=0":
        return markdown("# Invalid max_tokens\n", 400);
      case "GET /__farm-agent-check-missing.md":
        return markdown("# Not found\n", 404);
      case "GET /__farm-agent-check-missing":
        return accept.includes("text/markdown") ? markdown("# Not found\n", 404) : notFound();
      case "GET /company":
      case "GET /contact":
        return html(article(route));
      case "GET /sitemap.xml":
        return new Response(
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://acme.test/</loc><lastmod>2026-10-01</lastmod></url></urlset>',
          { headers: { "content-type": "application/xml" } },
        );
      case "GET /.well-known/ai-catalog.json":
        return Response.json({
          specVersion: "1.0",
          entries: [
            { type: "application/mcp-server-card+json", url: `${base}/api/mcp/server-card` },
          ],
        });
      case "GET /llms.txt":
        return text(
          "# Acme\n\n## Pages\n\n- [Home](https://acme.test/index.md)\n- [Pricing](https://acme.test/pricing.md)\n",
        );
      case "HEAD /llms-full.txt":
        return new Response(null, { status: 200 });
      case "GET /robots.txt":
        return text("User-agent: GPTBot\nAllow: /\n\nUser-agent: *\nAllow: /\n");
      case "GET /.well-known/api-catalog":
        return Response.json({
          linkset: [
            {
              anchor: `${base}/.well-known/api-catalog`,
              item: [{ href: "/api" }, { href: "/api/mcp" }],
            },
            { anchor: "/api", "service-desc": [{ href: `${base}/openapi.json` }] },
          ],
        });
      case "GET /openapi.json":
        return Response.json({ openapi: "3.1.0", paths: {} });
      case "POST /api/mcp":
        return new Response('{"error":"Unauthorized"}', {
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer resource_metadata="https://acme.test/.well-known/oauth-protected-resource/api/mcp"',
          },
        });
      default:
        return notFound();
    }
  };
}

test("passes every check for an app with all agent surfaces on", async () => {
  const requested = [];
  const fetch = completeApp();
  const report = await runFarmAgentCheck({
    url: "https://acme.test",
    fetch: (input, init) => {
      requested.push(`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`);
      return fetch(input, init);
    },
  });
  assert.equal(report.health, "ready", formatFarmAgentCheckReport(report, { color: false }));
  assert.deepEqual(
    report.checks.map((check) => `${check.status} ${check.code}`),
    [
      "pass AGENT_METADATA",
      "pass AGENT_JSON_LD",
      "pass AGENT_STRUCTURE",
      "pass AGENT_MARKDOWN_ADVERTISED",
      "pass AGENT_MARKDOWN_MIRROR",
      "pass AGENT_MARKDOWN_NEGOTIATION",
      "pass AGENT_MARKDOWN_404",
      "pass AGENT_MARKDOWN_VIEWS",
      "pass AGENT_NOT_FOUND",
      "pass AGENT_LLMS_TXT",
      "pass AGENT_LLMS_FULL",
      "pass AGENT_ROBOTS",
      "pass AGENT_SITEMAP",
      "pass AGENT_ORGANIZATION",
      "pass AGENT_TRUST_PAGES",
      "pass AGENT_API_CATALOG",
      "pass AGENT_OPENAPI",
      "pass AGENT_MCP",
      "pass AGENT_MCP_DISCOVERY",
    ],
  );
  assert.match(report.checks.find((check) => check.code === "AGENT_LLMS_TXT").message, /2 pages/);
  assert.match(report.checks.find((check) => check.code === "AGENT_MCP").message, /OAuth metadata/);
  assert.ok(requested.includes("POST /api/mcp"));
});

test("points each missing surface at the config that turns it on", async () => {
  const report = await runFarmAgentCheck({
    url: "http://localhost:3000",
    fetch: async (input) =>
      new URL(String(input)).pathname === "/"
        ? html("<html><head><title>Bare</title></head><body><p>Hi</p></body></html>")
        : notFound(),
  });
  assert.equal(report.health, "attention");
  const byCode = Object.fromEntries(report.checks.map((check) => [check.code, check]));
  assert.equal(byCode.AGENT_METADATA.status, "warn");
  assert.match(byCode.AGENT_METADATA.message, /meta description, canonical link, html lang/);
  assert.equal(byCode.AGENT_MARKDOWN_ADVERTISED.status, "warn");
  assert.equal(byCode.AGENT_MARKDOWN_MIRROR.status, "warn");
  assert.equal(byCode.AGENT_LLMS_TXT.status, "warn");
  assert.match(byCode.AGENT_LLMS_TXT.action, /agent: \{ llmsTxt: true \}/);
  assert.equal(byCode.AGENT_API_CATALOG.status, "info");
  assert.match(byCode.AGENT_API_CATALOG.action, /apiCatalog: true/);
  assert.match(byCode.AGENT_OPENAPI.action, /openapi: \{ enabled: true \}/);
  assert.equal(byCode.AGENT_MCP.title, "No MCP endpoint");
  assert.equal(byCode.AGENT_STRUCTURE.status, "warn");
  assert.match(byCode.AGENT_STRUCTURE.message, /^No H1/);
  assert.equal(byCode.AGENT_NOT_FOUND.status, "warn");
  assert.equal(byCode.AGENT_NOT_FOUND.title, "Missing pages answer 404 only in HTML");
  assert.equal(byCode.AGENT_SITEMAP.status, "warn");
  assert.equal(byCode.AGENT_ORGANIZATION.status, "info");
  assert.equal(byCode.AGENT_TRUST_PAGES.status, "info");
  assert.match(byCode.AGENT_TRUST_PAGES.message, /\/about, \/contact, \/privacy/);
  // Checks that need an earlier surface are skipped rather than reported twice.
  assert.equal(byCode.AGENT_MCP_DISCOVERY, undefined);
  assert.equal(byCode.AGENT_MARKDOWN_VIEWS, undefined);
  assert.equal(byCode.AGENT_LLMS_FULL, undefined);
});

test("probes beneath the URL's basePath", async () => {
  const requested = [];
  const fetch = completeApp("/app");
  const report = await runFarmAgentCheck({
    url: "https://acme.test/app/",
    fetch: (input, init) => {
      requested.push(new URL(String(input)).pathname);
      return fetch(input, init);
    },
  });
  assert.equal(report.health, "ready", formatFarmAgentCheckReport(report, { color: false }));
  assert.equal(report.target.page, "https://acme.test/app/");
  for (const pathname of [
    "/app/llms.txt",
    "/app/robots.txt",
    "/app/.well-known/api-catalog",
    "/app/index.md",
  ]) {
    assert.ok(requested.includes(pathname), pathname);
  }
});

test("reports broken surfaces as failures or warnings", async () => {
  const fetch = completeApp();
  const report = await runFarmAgentCheck({
    url: "https://acme.test",
    fetch: async (input, init) => {
      const { pathname } = new URL(String(input));
      if (pathname === "/openapi.json") return notFound();
      if (pathname === "/robots.txt") return text("User-agent: *\nDisallow: /\n");
      if (pathname === "/api/mcp") return new Response("", { status: 401 });
      return fetch(input, init);
    },
  });
  const byCode = Object.fromEntries(report.checks.map((check) => [check.code, check]));
  assert.equal(report.health, "error");
  assert.equal(byCode.AGENT_OPENAPI.status, "fail");
  assert.equal(byCode.AGENT_ROBOTS.status, "warn");
  assert.equal(byCode.AGENT_MCP.status, "warn");
  assert.match(byCode.AGENT_MCP.message, /without WWW-Authenticate/);
});

test("finds the MCP endpoint in another catalog by its title, or at --mcp", async () => {
  const app = completeApp();
  const requested = [];
  const fetch = async (input, init) => {
    const { pathname, search } = new URL(String(input));
    requested.push(`${init?.method ?? "GET"} ${pathname}`);
    if (pathname === "/.well-known/api-catalog") {
      return Response.json({
        linkset: [
          {
            anchor: "https://acme.test/.well-known/api-catalog",
            item: [
              { href: "https://acme.test/api/docs", title: "Documentation API" },
              { href: "https://acme.test/api/docs/tools", title: "Documentation MCP endpoint" },
            ],
          },
        ],
      });
    }
    if (pathname === "/api/docs/tools" || pathname === "/agents/mcp") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
    }
    // An older core ignores ?max_tokens and returns the page.
    if (pathname === "/index.md" && search === "?max_tokens=0") return markdown("# Acme\n");
    return app(input, init);
  };
  const report = await runFarmAgentCheck({ url: "https://acme.test", fetch });
  const byCode = Object.fromEntries(report.checks.map((check) => [check.code, check]));
  assert.equal(byCode.AGENT_MCP.title, "MCP endpoint is public");
  assert.ok(requested.includes("POST /api/docs/tools"));
  assert.equal(byCode.AGENT_MARKDOWN_VIEWS.status, "info");
  assert.match(byCode.AGENT_MARKDOWN_VIEWS.message, /Supported: \?outline, ETag\./);

  const custom = await runFarmAgentCheck({
    url: "https://acme.test",
    fetch,
    mcpPath: "/agents/mcp",
  });
  assert.ok(requested.includes("POST /agents/mcp"));
  assert.equal(
    custom.checks.find((check) => check.code === "AGENT_MCP").title,
    "MCP endpoint is public",
  );
});

test("checks agent-facing site gaps the way the farmjs.dev agent check does", async () => {
  const app = completeApp();
  // A heading level skipped, and an Organization without an address.
  const home = page
    .replace("<h2>Pricing</h2>", "<h3>Pricing</h3>")
    .replace(JSON.stringify(organization), JSON.stringify({ ...organization, address: undefined }));
  const report = await runFarmAgentCheck({
    url: "https://acme.test",
    fetch: async (input, init) => {
      const { pathname } = new URL(String(input));
      const accept = new Headers(init?.headers).get("accept") ?? "";
      // A catch-all that renders the homepage for every unknown path.
      if (
        pathname === "/__farm-agent-check-missing" ||
        pathname === "/contact" ||
        pathname === "/"
      ) {
        if (pathname === "/" && accept.includes("text/markdown")) return app(input, init);
        return html(home, { link: '</index.md>; rel="alternate"; type="text/markdown"' });
      }
      if (pathname === "/robots.txt")
        return text("User-agent: *\nAllow: /\nSitemap: https://acme.test/maps/site.xml\n");
      if (pathname === "/maps/site.xml") {
        return new Response("<urlset><url><loc>https://acme.test/</loc></url></urlset>", {
          headers: { "content-type": "application/xml" },
        });
      }
      if (pathname === "/.well-known/ai-catalog.json") return notFound();
      return app(input, init);
    },
  });
  const byCode = Object.fromEntries(report.checks.map((check) => [check.code, check]));
  assert.equal(byCode.AGENT_STRUCTURE.status, "warn");
  assert.match(byCode.AGENT_STRUCTURE.message, /headings skip from H1 to H3/i);
  assert.equal(byCode.AGENT_NOT_FOUND.status, "fail");
  assert.match(byCode.AGENT_NOT_FOUND.message, /answered 200/);
  assert.equal(byCode.AGENT_SITEMAP.status, "warn");
  assert.match(byCode.AGENT_SITEMAP.message, /maps\/site\.xml lists 1 pages, none with <lastmod>/);
  assert.equal(byCode.AGENT_ORGANIZATION.status, "info");
  assert.equal(byCode.AGENT_ORGANIZATION.message, "The Organization has no address.");
  // The catch-all homepage at /contact is not a contact page.
  assert.equal(byCode.AGENT_TRUST_PAGES.status, "info");
  assert.match(byCode.AGENT_TRUST_PAGES.message, /\/contact\.$/);
  assert.equal(byCode.AGENT_MCP_DISCOVERY.status, "info");
  assert.equal(report.health, "error");
});

test("fails clearly when nothing answers", async () => {
  const report = await runFarmAgentCheck({
    url: "http://localhost:3999",
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.equal(report.health, "error");
  assert.deepEqual(
    report.checks.map((check) => check.code),
    ["AGENT_PAGE_UNREACHABLE"],
  );
  assert.match(report.checks[0].message, /could not connect/);
  assert.match(formatFarmAgentCheckReport(report, { color: false }), /FARM \/ AGENT CHECK/);
  await assert.rejects(runFarmAgentCheck({ url: "ftp://acme.test" }), /http\(s\) URL/);
});

test("farm agent check probes a real server and exits by health", async () => {
  const app = completeApp();
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const result = await app(`http://127.0.0.1${request.url}`, {
      method: request.method,
      headers: request.headers,
    });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      cliBin,
      "agent",
      "check",
      origin,
      "--json",
    ]);
    const report = JSON.parse(stdout);
    assert.equal(report.health, "ready");
    assert.equal(report.checks.length, 19);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  await assert.rejects(
    execFileAsync(process.execPath, [cliBin, "agent", "check", origin, "--timeout", "500"]),
    (error) => error.code === 1 && /AGENT CHECK/.test(error.stdout),
  );
});
