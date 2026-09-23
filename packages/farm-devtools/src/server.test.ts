import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, ViteDevServer } from "vite";
import { installDevtoolsServer, isTrustedRequest } from "./server.js";

const server = { config: { server: { allowedHosts: ["dev.example.test"] } } } as never;
const request = (headers: Record<string, string>) => ({ headers }) as never;

describe("DevTools request boundary", () => {
  it("allows local requests and explicitly trusted development hosts", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "dev.example.test:3000"])
      expect(isTrustedRequest(request({ host }), server)).toBe(true);
    expect(
      isTrustedRequest(
        request({ host: "localhost:3000", origin: "http://localhost:3000" }),
        server,
      ),
    ).toBe(true);
  });
  it("rejects cross-origin, cross-site, malformed, and untrusted host requests", () => {
    expect(
      isTrustedRequest(request({ host: "localhost:3000", origin: "https://evil.test" }), server),
    ).toBe(false);
    expect(
      isTrustedRequest(request({ host: "localhost:3000", "sec-fetch-site": "cross-site" }), server),
    ).toBe(false);
    expect(isTrustedRequest(request({ host: "evil.test" }), server)).toBe(false);
    expect(isTrustedRequest(request({ host: "//evil.test" }), server)).toBe(false);
    expect(
      isTrustedRequest(
        request({ host: "localhost:3000", origin: "https://localhost:3000" }),
        server,
      ),
    ).toBe(false);
    for (const host of [
      "user@localhost",
      "localhost/path",
      "localhost?x",
      "localhost#x",
      "localhost\\path",
    ]) {
      expect(isTrustedRequest(request({ host }), server)).toBe(false);
    }
  });
});

describe("DevTools middleware", () => {
  async function run(url: string, inspect = false, method = "GET") {
    let middleware!: Connect.NextHandleFunction;
    const server = {
      config: { root: process.cwd(), server: {} },
      middlewares: {
        use(fn: Connect.NextHandleFunction) {
          middleware = fn;
        },
      },
    } as ViteDevServer;
    installDevtoolsServer(server, { inspect });
    const result = {
      status: 200,
      headers: {} as Record<string, string>,
      body: undefined as unknown,
      next: false,
    };
    const res = {
      get statusCode() {
        return result.status;
      },
      set statusCode(value) {
        result.status = value;
      },
      setHeader(key: string, value: string) {
        result.headers[key] = value;
      },
      end(body: unknown) {
        result.body = body;
      },
    } as ServerResponse;
    await middleware(
      { url, method, headers: { host: "localhost:3000" } } as IncomingMessage,
      res,
      () => {
        result.next = true;
      },
    );
    return result;
  }
  it("leaves core snapshot and launcher behavior to core", async () => {
    for (const url of ["/__farm/devtools.json", "/__farm/devtools", "/app", "http://["])
      expect((await run(url)).next).toBe(true);
  });
  it("omits both inspector endpoints when inspect is false", async () => {
    for (const url of ["/__farm/devtools/modules.json", "/__farm/devtools/module.json?id=test"])
      expect((await run(url)).status).toBe(404);
    expect((await run("/__farm/devtools?embedded=1")).body).toContain('data-inspect="false"');
  });
  it("serves a no-store, same-origin iframe and obeys HEAD", async () => {
    const response = await run("/__farm/devtools?embedded=1", true);
    expect(response.body).toContain('data-inspect="true"');
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(response.headers["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    const head = await run("/__farm/devtools?embedded=1", true, "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBeUndefined();
    expect(head.headers["Content-Type"]).toContain("text/html");
  });
});
