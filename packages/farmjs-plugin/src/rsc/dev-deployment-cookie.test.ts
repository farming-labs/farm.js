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
 * farm dev of an RSC app whose `/public` page opts into shared caching through middleware
 * (`cache: "public"`), on a real Vite server: the deployment cookie follows the cache policy, as
 * in core's production server.
 */
describe("RSC deployment cookie under farm dev", () => {
  let root: string;
  let server: ViteDevServer;
  let origin: string;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "farm-rsc-dev-deployment-cookie-"));
    const write = (file: string, source: string) => {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source);
    };
    write(
      "package.json",
      JSON.stringify({ name: "farm-rsc-dev-deployment-cookie", private: true, type: "module" }),
    );
    write(
      "src/layout.tsx",
      "export default function Layout({ children }) { return <section>{children}</section>; }",
    );
    write("src/page.tsx", "export default function Page() { return <main>Home</main>; }");
    write(
      "src/public/page.tsx",
      "export default function Page() { return <main>Public page</main>; }",
    );
    write(
      "src/isr/page.tsx",
      "export const revalidate = 300;\nexport default function Page() { return <main>Revalidating page</main>; }",
    );
    write(
      "src/public/middleware.ts",
      `export const config = { cache: "public" };
export function middleware(request, context) {
  context.headers.set("cache-control", "public, max-age=60");
}`,
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
      deploymentId: "dev-release",
      md: { cache: 300 },
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

  const get = (pathname: string, headers: Record<string, string> = {}) =>
    fetch(origin + pathname, {
      headers: { accept: "text/html", ...headers },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });

  it("sets the cookie on a page that stays out of shared caches", async () => {
    const response = await get("/", { cookie: "__farm_deployment=old-release" });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Home");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.getSetCookie()).toEqual([
      "__farm_deployment=dev-release; Path=/; HttpOnly; SameSite=Lax",
    ]);
  }, 30_000);

  it("sends a publicly cacheable page without the cookie", async () => {
    const response = await get("/public");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Public page");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("x-farm-deployment-id")).toBe("dev-release");
    expect(response.headers.getSetCookie()).toEqual([]);
  }, 30_000);

  it("lets md.cache share the Markdown mirror of a publicly cacheable page", async () => {
    // The mirror renders the page through the normal request path, which no longer sets a cookie
    // there; the mirror of a private page stays private.
    const mirror = await get("/public.md", { accept: "text/markdown" });
    expect(mirror.status).toBe(200);
    expect(await mirror.text()).toContain("Public page");
    expect(mirror.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
    expect(mirror.headers.getSetCookie()).toEqual([]);

    // A browser that loaded a page holds the deployment cookie, which names a release, not a
    // visitor; another cookie keeps the mirror private.
    for (const [cookie, cacheControl] of [
      ["__farm_deployment=dev-release", "public, max-age=300, s-maxage=300"],
      ["session=abc; __farm_deployment=dev-release", "private, no-store"],
    ]) {
      const response = await get("/public.md", { accept: "text/markdown", cookie });
      expect(response.status, cookie).toBe(200);
      expect(response.headers.get("cache-control"), cookie).toBe(cacheControl);
    }

    const home = await get("/index.md", { accept: "text/markdown" });
    expect(home.status).toBe(200);
    expect(home.headers.get("cache-control")).toBe("private, no-store");
    expect(home.headers.getSetCookie()).toEqual([]);
  }, 30_000);

  it("keeps a revalidating page out of shared caches, as core's dev server does", async () => {
    for (const accept of ["text/html", "text/x-component"]) {
      const response = await get("/isr", { accept });
      expect(response.status, accept).toBe(200);
      expect(await response.text(), accept).toContain("Revalidating page");
      expect(response.headers.get("cache-control"), accept).toBe("private, no-store");
    }
  }, 30_000);

  it("refuses a request naming another deployment without the cookie", async () => {
    const response = await get("/", { "x-farm-deployment-id": "old-release" });
    expect(response.status).toBe(409);
    expect(response.headers.get("x-farm-deployment-id")).toBe("dev-release");
    expect(response.headers.getSetCookie()).toEqual([]);
  }, 30_000);
});
