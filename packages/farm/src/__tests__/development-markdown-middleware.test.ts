// @vitest-environment node

import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";
import {
  literalRouteExposure,
  literalRouteFiles,
  verifyLiteralRouteExposure,
} from "./markdown-route-contract";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  vi.restoreAllMocks();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

describe("development markdown-source middleware ordering", () => {
  it("serves large layout rows through real HTML rendering and Markdown negotiation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-md-rows-"));
    temporaryRoots.add(root);
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    for (const pkg of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
        path.join(root, "node_modules", pkg),
        "junction",
      );
    }
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await writeModule(
      root,
      "src/app/layout.tsx",
      `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
    );
    await writeModule(
      root,
      "src/app/rows/page.tsx",
      `import React from "react";
export default function Page() {
  return <main><div>{Array.from({ length: 1000 }, (_, index) => <span key={index}>Item {index}</span>)}</div></main>;
}`,
    );
    const server = await createServer({
      root,
      md: { includeMetadata: false },
      images: { provider: "none" },
    });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;
    const expected = `${Array.from({ length: 1_000 }, (_, index) => `Item ${index}`).join(" ")}\n`;
    for (const suffix of [".md", ""]) {
      const url = `${origin}/rows${suffix}`;
      const response = await fetch(url, { headers: { accept: "text/markdown" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      expect(await response.text()).toBe(expected);
      for (const method of ["GET", "HEAD"]) {
        const cached = await fetch(url, {
          method,
          headers: { accept: "text/markdown", "if-none-match": response.headers.get("etag")! },
        });
        expect(cached.status).toBe(304);
        expect(await cached.text()).toBe("");
      }
    }
  });

  it("serves actions from the rendered page through the real Markdown fetch path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-md-actions-"));
    temporaryRoots.add(root);
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    for (const pkg of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
        path.join(root, "node_modules", pkg),
        "junction",
      );
    }
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await writeModule(
      root,
      "src/app/layout.tsx",
      `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
    );
    await writeModule(
      root,
      "src/app/contact/page.tsx",
      `import React from "react";
export default function Page() {
  return <main><h1>Contact</h1><form method="post" action="/api/contact">
    <input type="email" name="email" required /><button>Send</button>
  </form><form hidden><input name="secret" /></form></main>;
}`,
    );
    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;
    for (const suffix of [".md", ""]) {
      const url = `${origin}/contact${suffix}?actions&section=missing&max_tokens=invalid`;
      const response = await fetch(url, { headers: { accept: "text/markdown" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(await response.json()).toEqual({
        page: "/contact",
        markdown: "/contact.md",
        actions: [
          {
            type: "form",
            method: "POST",
            action: "/api/contact",
            enctype: "application/x-www-form-urlencoded",
            fields: [{ name: "email", type: "email", required: true }],
            submit: [{ label: "Send" }],
          },
        ],
      });
      for (const method of ["GET", "HEAD"]) {
        const cached = await fetch(url, {
          method,
          headers: { accept: "text/markdown", "if-none-match": response.headers.get("etag")! },
        });
        expect(cached.status).toBe(304);
        expect(await cached.text()).toBe("");
      }
      const head = await fetch(url, { method: "HEAD", headers: { accept: "text/markdown" } });
      expect(head.status).toBe(200);
      expect(head.headers.get("etag")).toBe(response.headers.get("etag"));
      expect(await head.text()).toBe("");
    }
    const normal = await fetch(`${origin}/contact.md`);
    expect(await normal.text()).toContain("# Contact");
  }, 30_000);

  it("closes the internal page fetch when a Markdown client disconnects", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-md-abort-"));
    temporaryRoots.add(root);
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    for (const pkg of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
        path.join(root, "node_modules", pkg),
        "junction",
      );
    }
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await writeModule(
      root,
      "src/app/layout.tsx",
      `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
    );
    await writeModule(
      root,
      "src/app/slow/page.tsx",
      `import React from "react";
export default function Page() { return <main>Slow page</main>; }`,
    );

    let probe: {
      started(): void;
      reading(): void;
      gate: Promise<void>;
      streaming: boolean;
      closed: boolean;
    };
    // The mirror reads the page through the dev server's own listener; note when it starts
    // reading the page's HTML body.
    const realText = Response.prototype.text;
    vi.spyOn(Response.prototype, "text").mockImplementation(function (this: Response) {
      const pending = realText.call(this);
      if (this.headers.get("content-type") === "text/html") probe.reading();
      return pending;
    });
    const server = await createServer({
      root,
      images: { provider: "none" },
      plugins: [
        {
          name: "markdown-cancellation-probe",
          async beforeRequest(req, res) {
            if (req.url !== "/slow" || req.headers.accept !== "text/html") return;
            const current = probe;
            res.once("close", () => {
              current.closed = true;
            });
            res.setHeader("Content-Type", "text/html");
            if (current.streaming) res.write("<h1>Slow page</h1>");
            current.started();
            await current.gate;
            res.end("<p>Complete</p>");
          },
        },
      ],
    });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    for (const method of ["GET", "HEAD"]) {
      for (const suffix of [".md", ""]) {
        for (const streaming of [false, true]) {
          let started!: () => void;
          let reading!: () => void;
          let finish!: () => void;
          const ready = new Promise<void>((resolve) => {
            started = resolve;
          });
          const gate = new Promise<void>((resolve) => {
            finish = resolve;
          });
          const readingBody = new Promise<void>((resolve) => {
            reading = resolve;
          });
          probe = { started, reading, gate, streaming, closed: false };
          const client = new AbortController();
          const request = fetch(`${origin}/slow${suffix}`, {
            method,
            headers: { accept: "text/markdown" },
            signal: client.signal,
          }).then(
            () => "completed",
            (error) => error.name,
          );
          try {
            await ready;
            // Do not mistake headers being written for a body read having started.
            if (streaming) await readingBody;
            client.abort();
            expect(await request).toBe("AbortError");
            await vi.waitFor(() => expect(probe.closed).toBe(true), { timeout: 5_000 });
          } finally {
            client.abort();
            finish();
            await request;
          }
        }
      }
    }
    // A disconnect must not poison the next successful mirror request.
    probe = { started() {}, reading() {}, gate: Promise.resolve(), streaming: true, closed: false };
    const healthy = await fetch(`${origin}/slow.md`);
    expect(healthy.status).toBe(200);
    expect(await healthy.text()).toContain("# Slow page");
    await vi.waitFor(() => expect(probe.closed).toBe(true));
  }, 30_000);

  it("preserves terminal page responses through the real Markdown fetch path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-md-terminal-"));
    temporaryRoots.add(root);
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    for (const pkg of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
        path.join(root, "node_modules", pkg),
        "junction",
      );
    }
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await writeModule(
      root,
      "farm.config.ts",
      `export default {
  middleware: [204, 205, 304, 429].map(status => ({
    matcher: "/terminal/" + status,
    handler() {
      return new Response(status === 429 ? "Slow down" : null, {
        status,
        headers: {
          "content-type": status === 429 ? "text/plain" : "text/html",
          "retry-after": "60",
          "x-terminal-status": String(status),
        },
      });
    },
  })),
};`,
    );
    await writeModule(
      root,
      "src/app/layout.tsx",
      `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
    );
    await writeModule(
      root,
      "src/app/terminal/[status]/page.tsx",
      `import React from "react";
export default function Page() { return <main>must not render</main>; }`,
    );

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    for (const status of [204, 205, 304, 429]) {
      for (const method of ["GET", "HEAD"]) {
        for (const suffix of [".md", ""]) {
          const response = await fetch(
            `http://localhost:${address.port}/terminal/${status}${suffix}`,
            {
              method,
              headers: { accept: "text/markdown" },
            },
          );
          expect(response.status).toBe(status);
          expect(response.headers.get("x-terminal-status")).toBe(String(status));
          expect(response.headers.get("retry-after")).toBe("60");
          expect(await response.text()).toBe(status === 429 && method === "GET" ? "Slow down" : "");
        }
      }
    }
  }, 30_000);

  it("preserves HTML errors through the real Markdown fetch path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-md-error-"));
    temporaryRoots.add(root);
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    for (const pkg of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
        path.join(root, "node_modules", pkg),
        "junction",
      );
    }
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await writeModule(
      root,
      "farm.config.ts",
      `export default {
  middleware: [401, 429, 503].map(status => ({
    matcher: "/error/" + status,
    async handler(ctx, next) {
      // Fail the internal HTML render, not the outer negotiated request:
      // an outer middleware short-circuit intentionally bypasses conversion.
      if (ctx.request.headers.accept !== "text/html") return next();
      return new Response("<h1>Request failed</h1><p>Try later.</p>", {
        status,
        headers: {
          "content-type": "text/html",
          "retry-after": "60",
          "www-authenticate": 'Bearer realm="farm"',
          "cache-control": "no-store",
        },
      });
    },
  })),
};`,
    );
    await writeModule(
      root,
      "src/app/layout.tsx",
      `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
    );
    await writeModule(
      root,
      "src/app/error/[status]/page.tsx",
      `import React from "react";
export default function Page() { return <main>must not render</main>; }`,
    );

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    for (const status of [401, 429, 503]) {
      for (const method of ["GET", "HEAD"]) {
        for (const suffix of [".md", ""]) {
          for (const query of ["?section=missing", "?max_tokens=invalid", "?actions"]) {
            const response = await fetch(
              `http://localhost:${address.port}/error/${status}${suffix}${query}`,
              {
                method,
                headers: { accept: "text/markdown" },
              },
            );
            expect(response.status).toBe(status);
            expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
            expect(response.headers.get("www-authenticate")).toBe('Bearer realm="farm"');
            expect(response.headers.get("retry-after")).toBe("60");
            expect(response.headers.get("cache-control")).toBe("no-store");
            expect(await response.text()).toBe(
              method === "HEAD"
                ? ""
                : `Source: /error/${status}\n\n# Request failed\n\nTry later.\n`,
            );
          }
        }
      }
    }
  }, 30_000);

  it("isolates Markdown validators and ranges through the real internal HTML fetch", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-md-validators-"));
    temporaryRoots.add(root);
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    for (const pkg of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
        path.join(root, "node_modules", pkg),
        "junction",
      );
    }
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await writeModule(
      root,
      "farm.config.ts",
      `export default {
  middleware: [{
    matcher: "/conditional",
    async handler(ctx, next) {
      if (ctx.request.headers.accept !== "text/html") return next();
      const headers = { "content-type": "text/html", etag: '"html-v1"', "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT" };
      const match = ctx.request.headers["if-match"];
      if ((match !== undefined && match !== "*" && match !== headers.etag) || (match === undefined && ctx.request.headers["if-unmodified-since"])) return new Response("<h1>HTML precondition failed</h1>", { status: 412, headers });
      const validator = ctx.request.headers["if-none-match"];
      if (validator === headers.etag || validator === "*" || (validator === undefined && ctx.request.headers["if-modified-since"] === headers["last-modified"])) return new Response(null, { status: 304, headers });
      if (ctx.request.headers.range) return new Response("<h1>Part", { status: 206, headers: { ...headers, "content-range": "bytes 0-7/20" } });
      return new Response("<h1>Whole page</h1>", { headers });
    },
  }],
};`,
    );
    await writeModule(
      root,
      "src/app/layout.tsx",
      `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
    );
    await writeModule(
      root,
      "src/app/conditional/page.tsx",
      `import React from "react";
export default function Page() { return <main>must not render</main>; }`,
    );
    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    for (const method of ["GET", "HEAD"]) {
      for (const suffix of [".md", ""]) {
        for (const controls of [
          { "if-none-match": '"html-v1"' },
          { "if-modified-since": "Wed, 21 Oct 2015 07:28:00 GMT" },
          { "if-unmodified-since": "Tue, 20 Oct 2015 07:28:00 GMT" },
          { "if-match": "*" },
          { range: "bytes=0-7", "if-range": '"html-v1"' },
        ] as Record<string, string>[]) {
          const response = await fetch(`${origin}/conditional${suffix}`, {
            method,
            headers: { accept: "text/markdown", ...controls },
          });
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
          expect(response.headers.has("content-range")).toBe(false);
          const etag = response.headers.get("etag")!;
          expect(etag).not.toBe('"html-v1"');
          expect(await response.text()).toBe(
            method === "HEAD" ? "" : "Source: /conditional\n\n# Whole page\n",
          );
          const cached = await fetch(`${origin}/conditional${suffix}`, {
            method,
            headers: { accept: "text/markdown", ...controls, "if-none-match": etag },
          });
          expect(cached.status).toBe(304);
          expect(cached.headers.get("etag")).toBe(etag);
          expect(cached.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
          expect(await cached.text()).toBe("");
        }
        for (const match of ['"html-v1"', '"stale"']) {
          const failed = await fetch(`${origin}/conditional${suffix}`, {
            method,
            headers: { accept: "text/markdown", "if-match": match, "if-none-match": "*" },
          });
          expect(failed.status).toBe(412);
          expect(failed.headers.get("cache-control")).toBe("no-store");
          expect(await failed.text()).toBe("");
        }
      }
    }
    // Ordinary HTML requests still reach the app's own validator/range handling.
    const htmlCached = await fetch(`${origin}/conditional`, {
      headers: { accept: "text/html", "if-none-match": '"html-v1"' },
    });
    expect(htmlCached.status).toBe(304);
    expect(htmlCached.headers.get("etag")).toBe('"html-v1"');
    const htmlRange = await fetch(`${origin}/conditional`, {
      headers: { accept: "text/html", range: "bytes=0-7" },
    });
    expect(htmlRange.status).toBe(206);
    expect(htmlRange.headers.get("content-range")).toBe("bytes 0-7/20");
    expect(await htmlRange.text()).toBe("<h1>Part");
    const htmlMatch = await fetch(`${origin}/conditional`, {
      headers: { accept: "text/html", "if-match": '"html-v1"' },
    });
    expect(htmlMatch.status).toBe(200);
    expect(await htmlMatch.text()).toBe("<h1>Whole page</h1>");
    const htmlDate = await fetch(`${origin}/conditional`, {
      headers: { accept: "text/html", "if-unmodified-since": "Tue, 20 Oct 2015 07:28:00 GMT" },
    });
    expect(htmlDate.status).toBe(412);
    expect(await htmlDate.text()).toBe("<h1>HTML precondition failed</h1>");
  }, 30_000);

  it("runs app middleware before serving raw markdown page sources", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-md-middleware-"));
    temporaryRoots.add(root);

    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", "react")),
      path.join(root, "node_modules", "react"),
      "junction",
    );
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", "react-dom")),
      path.join(root, "node_modules", "react-dom"),
      "junction",
    );
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await fs.writeFile(
      path.join(root, "farm.config.ts"),
      `export default {
  middleware: [
    {
      matcher: "/private/:path*",
      handler() {
        return new Response("sign-in required", {
          status: 401,
          headers: { "x-markdown-guard": "yes" },
        });
      },
    },
    {
      matcher: "/members",
      handler(ctx, next) {
        if (ctx.cookies.get("member")) return next();
        return new Response("members require sign-in", { status: 401 });
      },
    },
    {
      matcher: "/office",
      handler(ctx, next) {
        if (ctx.request.headers["x-real-ip"] === "10.0.0.5") return next();
        return new Response("office network only", { status: 403 });
      },
    },
    {
      matcher: "/partners",
      handler(ctx, next) {
        if (ctx.request.headers["x-api-key"] === "partner-key") return next();
        return new Response("partners require a key", { status: 401 });
      },
    },
  ],
};`,
    );
    await writeModule(
      root,
      "src/app/layout.tsx",
      `import React from "react";
export default function Layout({ children }) {
  return <>{children}</>;
}`,
    );
    await writeModule(
      root,
      "src/app/private/notes/page.md",
      `# Private notes\n\nprivate-notes-source\n`,
    );
    await writeModule(root, "src/app/open/page.md", `# Open notes\n\nopen-notes-source\n`);
    await writeModule(root, "src/app/members/page.md", `# Members\n\nmembers-only-source\n`);
    await writeModule(root, "src/app/partners/page.md", `# Partners\n\npartners-only-source\n`);
    await writeModule(root, "src/app/office/page.md", `# Office\n\noffice-only-source\n`);

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    // A middleware guard on the route must also cover its raw .md source.
    const guardedResponse = await fetch(`${origin}/private/notes.md`);
    expect(guardedResponse.status).toBe(401);
    expect(guardedResponse.headers.get("x-markdown-guard")).toBe("yes");
    await expect(guardedResponse.text()).resolves.not.toContain("private-notes-source");

    // The /members matcher does not match /members.md. A guarded page has no
    // .md version, with or without a session, while the page still renders.
    for (const headers of [{}, { cookie: "member=1" }] as Record<string, string>[]) {
      const membersMarkdown = await fetch(`${origin}/members.md`, { headers });
      expect(membersMarkdown.status).toBe(404);
      await expect(membersMarkdown.text()).resolves.not.toContain("members-only-source");
    }
    const membersPage = await fetch(`${origin}/members`, { headers: { cookie: "member=1" } });
    expect(membersPage.status).toBe(200);
    await expect(membersPage.text()).resolves.toContain("members-only-source");

    // A guard trusting a custom header sees the anonymous check without it, so a key holder
    // cannot put the page's source under a public cache, by `.md` or by negotiation.
    const keyed = { "x-api-key": "partner-key" };
    const partnersMarkdown = await fetch(`${origin}/partners.md`, { headers: keyed });
    expect(partnersMarkdown.status).toBe(404);
    expect(partnersMarkdown.headers.get("cache-control")).toBe("private, no-store");
    await expect(partnersMarkdown.text()).resolves.not.toContain("partners-only-source");
    const partnersNegotiated = await fetch(`${origin}/partners`, {
      headers: { ...keyed, accept: "text/markdown" },
    });
    // The key holder may read the page; whatever represents it stays out of shared caches.
    expect(partnersNegotiated.headers.get("cache-control")).toBe("private, no-store");
    await partnersNegotiated.body?.cancel();

    // An IP allowlist sees the anonymous check without the caller's client IP headers.
    for (const officeHeaders of [
      { "x-real-ip": "10.0.0.5" },
      { "x-forwarded-for": "10.0.0.5", "x-real-ip": "10.0.0.5" },
    ]) {
      const officeMarkdown = await fetch(`${origin}/office.md`, { headers: officeHeaders });
      expect(officeMarkdown.status).toBe(404);
      expect(officeMarkdown.headers.get("cache-control")).toBe("private, no-store");
      await expect(officeMarkdown.text()).resolves.not.toContain("office-only-source");
      const officeNegotiated = await fetch(`${origin}/office`, {
        headers: { ...officeHeaders, accept: "text/markdown" },
      });
      expect(officeNegotiated.headers.get("cache-control") ?? "").not.toContain("public");
      await officeNegotiated.body?.cancel();
    }
    const officeIpOpen = await fetch(`${origin}/open.md`, { headers: { "x-real-ip": "10.0.0.5" } });
    expect(officeIpOpen.status).toBe(200);
    expect(officeIpOpen.headers.get("cache-control")).toContain("public");
    await officeIpOpen.body?.cancel();

    // Routes outside every matcher keep serving their markdown source.
    const openResponse = await fetch(`${origin}/open.md`);
    expect(openResponse.status).toBe(200);
    expect(openResponse.headers.get("content-type")).toContain("text/markdown");
    expect(openResponse.headers.get("cache-control")).toContain("public");
    await expect(openResponse.text()).resolves.toContain("open-notes-source");
    // A public page's source is the same, and still public, for a caller with a key.
    const keyedOpen = await fetch(`${origin}/open.md`, { headers: keyed });
    expect(keyedOpen.status).toBe(200);
    expect(keyedOpen.headers.get("cache-control")).toContain("public");
    await expect(keyedOpen.text()).resolves.toContain("open-notes-source");
  }, 30_000);

  it("keeps literal exposure and dynamic fallbacks after a long list of route misses", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-md-routes-"));
    temporaryRoots.add(root);
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    for (const pkg of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
        path.join(root, "node_modules", pkg),
        "junction",
      );
    }
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await writeModule(
      root,
      "src/app/layout.tsx",
      `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
    );
    for (const [file, source] of Object.entries(literalRouteFiles))
      await writeModule(root, file, source);
    const server = await createServer({
      root,
      md: { expose: literalRouteExposure, includeMetadata: false },
      images: { provider: "none" },
    });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    await verifyLiteralRouteExposure(`http://localhost:${address.port}`);
  });

  it("renders the mirror's page on its own listener, whatever host the caller names", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-md-host-"));
    temporaryRoots.add(root);
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    for (const pkg of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
        path.join(root, "node_modules", pkg),
        "junction",
      );
    }
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await writeModule(
      root,
      "src/app/docs/[...slug]/page.tsx",
      `import React from "react";
export default function Page() { return <main>Rendered doc page</main>; }`,
    );
    // Stands in for an internal-only service on the developer's machine.
    const seen: string[] = [];
    const internal = http.createServer((req, res) => {
      seen.push(req.url ?? "");
      res.setHeader("content-type", "text/html");
      res.end("<h1>INTERNAL-SERVICE-SECRET</h1>");
    });
    await new Promise<void>((resolve) => internal.listen(0, "127.0.0.1", resolve));
    try {
      const internalPort = (internal.address() as { port: number }).port;
      const server = await createServer({ root, images: { provider: "none" } });
      servers.add(server);
      await server.listen(await getAvailablePort());
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Missing dev server address");
      const get = (pathname: string, headers: Record<string, string>) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          const request = http.request(
            { host: address.address, port: address.port, path: pathname, headers },
            (response) => {
              let body = "";
              response.setEncoding("utf8");
              response.on("data", (chunk) => (body += chunk));
              response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
            },
          );
          request.on("error", reject);
          request.end();
        });

      for (const [pathname, extra] of [
        ["/docs/x.md?a=1", {}],
        ["/docs/x", { accept: "text/markdown" }],
      ] as const) {
        const response = await get(pathname, { host: `127.0.0.1:${internalPort}`, ...extra });
        expect(response.body).not.toContain("INTERNAL-SERVICE-SECRET");
        expect(response.body).toContain("Rendered doc page");
      }
      expect(seen).toEqual([]);
      // The page is read as identity HTML even when the caller accepts compressed bodies.
      const gzip = await get("/docs/x.md", {
        host: `localhost:${address.port}`,
        "accept-encoding": "gzip, br",
      });
      expect(gzip.status).toBe(200);
      expect(gzip.body).toContain("Rendered doc page");
    } finally {
      await new Promise((resolve) => internal.close(resolve));
    }
  }, 30_000);
});
