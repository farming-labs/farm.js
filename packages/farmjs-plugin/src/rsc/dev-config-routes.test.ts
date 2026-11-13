import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import viteRsc from "@vitejs/plugin-rsc";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineConfig } from "./index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * farm dev of an RSC app with basePath "/console" and config redirects(), rewrites() and
 * headers(), on a real Vite server configured as `farm dev` configures it: defineConfig() plus the
 * Farm config's route functions.
 */
describe("RSC config redirects, rewrites and headers under farm dev", () => {
  let root: string;
  let server: ViteDevServer;
  let origin: string;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "farm-rsc-dev-config-routes-"));
    const write = (file: string, source: string) => {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source);
    };
    write(
      "package.json",
      JSON.stringify({ name: "farm-rsc-dev-config-routes", private: true, type: "module" }),
    );
    write(
      "src/layout.tsx",
      "export default function Layout({ children }) { return <section>{children}</section>; }",
    );
    write("src/page.tsx", "export default function Page() { return <main>Home page</main>; }");
    write(
      "src/about/page.tsx",
      "export default function Page() { return <main>About page</main>; }",
    );
    write(
      "src/guarded/page.tsx",
      "export default function Page() { return <main>Guarded page</main>; }",
    );
    write(
      "src/guarded/middleware.ts",
      `export function middleware(request, context) {
  context.headers.set("x-mw-path", new URL(request.url).pathname);
}`,
    );
    write(
      "src/api/hello/route.ts",
      `export function GET(request) { return Response.json({ hello: new URL(request.url).pathname }); }`,
    );
    for (const packageName of [
      "@farm.js/core",
      "@vitejs/plugin-rsc",
      "react",
      "react-dom",
      "react-server-dom-webpack",
      "rsc-html-stream",
      "vite",
    ]) {
      const source = [
        path.join(packageRoot, "node_modules", packageName),
        path.resolve(packageRoot, "../../examples/rsc-demo/node_modules", packageName),
      ].find((candidate) => existsSync(candidate));
      if (!source) throw new Error(`Missing fixture dependency: ${packageName}`);
      const target = path.join(root, "node_modules", packageName);
      mkdirSync(path.dirname(target), { recursive: true });
      symlinkSync(realpathSync(source), target, process.platform === "win32" ? "junction" : "dir");
    }

    const config = defineConfig({
      srcDir: "src",
      routesDir: "",
      basePath: "/console",
      plugins: viteRsc({
        serverHandler: false,
        entries: {
          rsc: "./.farm/rsc-entries/entry.rsc.tsx",
          ssr: "./.farm/rsc-entries/entry.ssr.tsx",
          client: "./.farm/rsc-entries/entry.browser.tsx",
        },
      }),
    });
    server = await createServer({
      ...config,
      root,
      configFile: false,
      logLevel: "silent",
      customLogger: undefined,
      redirects: async () => [
        { source: "/old", destination: "/about", permanent: true },
        { source: "/cfg/:slug", destination: "/:slug" },
        { source: "/package.json", destination: "/about" },
        { source: "/away", destination: "https://example.com/elsewhere" },
      ],
      rewrites: () => [
        { source: "/alias", destination: "/about" },
        // /about is a page, so this never applies.
        { source: "/about", destination: "/" },
        { source: "/hello-alias", destination: "/api/hello" },
        { source: "/alias-guarded", destination: "/guarded" },
      ],
      headers: () => [
        { source: "/about", headers: [{ key: "x-config-header", value: "about" }] },
        { source: "/api/:path*", headers: [{ key: "x-config-header", value: "api" }] },
        { source: "/old", headers: [{ key: "x-config-header", value: "old" }] },
      ],
      server: { host: "127.0.0.1", port: 0 },
    } as never);
    await server.listen();
    const address = server.httpServer!.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  const request = (pathname: string, init: RequestInit = {}) =>
    fetch(origin + pathname, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      ...init,
    });

  it("redirects before any route, for any method, below the basePath", async () => {
    for (const method of ["GET", "POST"]) {
      const redirected = await request("/console/old?tab=1", { method });
      expect(redirected.status, method).toBe(308);
      expect(redirected.headers.get("location")).toBe("/console/about?tab=1");
      // headers() apply to the redirect too.
      expect(redirected.headers.get("x-config-header")).toBe("old");
      expect(await redirected.text()).toBe("Redirecting to /console/about?tab=1");
    }

    const external = await request("/console/away");
    expect(external.status).toBe(307);
    expect(external.headers.get("location")).toBe("https://example.com/elsewhere");

    // An encoded slash stays encoded, so the target never becomes another origin.
    const encoded = await request("/console/cfg/%2F%2Fexample.com?q=1");
    expect(encoded.status).toBe(307);
    expect(encoded.headers.get("location")).toBe("/console/%2F%2Fexample.com?q=1");
  }, 60_000);

  it("sends a payload request to the destination's payload", async () => {
    const redirected = await request("/console/old.rsc", {
      headers: { accept: "text/x-component" },
    });
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get("location")).toBe("/console/about.rsc");

    const rewritten = await request("/console/alias.rsc", {
      headers: { accept: "text/x-component" },
    });
    expect(rewritten.status).toBe(200);
    expect(rewritten.headers.get("content-type")).toContain("text/x-component");
    expect(await rewritten.text()).toContain("About page");
  }, 60_000);

  it("rewrites a URL no route answers, through middleware, and leaves pages alone", async () => {
    const rewritten = await request("/console/alias");
    expect(rewritten.status).toBe(200);
    expect(await rewritten.text()).toContain("About page");

    const about = await request("/console/about");
    expect(about.status).toBe(200);
    expect(about.headers.get("x-config-header")).toBe("about");
    expect(await about.text()).toContain("About page");

    const guarded = await request("/console/alias-guarded");
    expect(guarded.status).toBe(200);
    expect(guarded.headers.get("x-mw-path")).toMatch(/\/guarded$/);
    expect(await guarded.text()).toContain("Guarded page");

    const api = await request("/console/hello-alias");
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ hello: "/api/hello" });
  }, 60_000);

  it("applies headers() to API routes", async () => {
    const api = await request("/api/hello");
    expect(api.status).toBe(200);
    expect(api.headers.get("x-config-header")).toBe("api");
  }, 60_000);

  it("routes a navigation to a source file's path, and leaves Vite's own requests alone", async () => {
    const navigation = await request("/package.json");
    expect(navigation.status).toBe(307);
    expect(navigation.headers.get("location")).toBe("/console/about");

    const module = await request("/package.json", { headers: { "sec-fetch-dest": "script" } });
    expect(module.status).toBe(200);
  }, 60_000);
});
