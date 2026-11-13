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
 * farm dev of an RSC app with basePath "/console" and en/fr locales, on a real Vite server
 * configured as `farm dev` configures it: defineConfig() plus the Farm config's `i18n`.
 */
describe("RSC i18n under farm dev", () => {
  let root: string;
  let server: ViteDevServer;
  let origin: string;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "farm-rsc-dev-i18n-"));
    const write = (file: string, source: string) => {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source);
    };
    write(
      "package.json",
      JSON.stringify({ name: "farm-rsc-dev-i18n", private: true, type: "module" }),
    );
    write("src/messages/en.json", JSON.stringify({ greeting: "Hello" }));
    write("src/messages/fr.json", JSON.stringify({ greeting: "Bonjour" }));
    write(
      "src/layout.tsx",
      "export default function Layout({ children }) { return <section>{children}</section>; }",
    );
    write("src/page.tsx", "export default function Page() { return <main>Home</main>; }");
    write(
      "src/about/page.tsx",
      `import { getLocale, getLocaleSource, t } from "@farm.js/core/i18n/server";
export default function Page() { return <main>{"Locale " + getLocale() + " from " + getLocaleSource() + ": " + t("greeting")}</main>; }`,
    );
    write(
      "src/api/locale/route.ts",
      `import { getLocale } from "@farm.js/core/i18n/server";
export function GET() { return Response.json({ locale: getLocale() }); }`,
    );
    write(
      "src/go/page.tsx",
      `import { redirect } from "@farm.js/core/navigation";
export default async function Page() { redirect("/about"); }`,
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
      i18n: { locales: ["en", "fr"], defaultLocale: "en" },
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
      // An unsupported language leaves the default locale (fetch sends "*" otherwise).
      headers: { "accept-language": "de", ...headers },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });

  it("renders server components in the request's locale", async () => {
    const french = await get("/console/fr/about");
    expect(french.status).toBe(200);
    const html = await french.text();
    expect(html).toContain("Locale fr from url: Bonjour");
    expect(html).toContain('<html lang="fr"');

    const english = await get("/console/about");
    expect(english.status).toBe(200);
    expect(await english.text()).toContain("Locale en from default: Hello");

    const payload = await get("/console/fr/about.rsc");
    expect(payload.status).toBe(200);
    expect(await payload.text()).toContain("Locale fr from url: Bonjour");
  }, 60_000);

  it("reads an edited catalog without a restart", async () => {
    writeFileSync(path.join(root, "src/messages/fr.json"), JSON.stringify({ greeting: "Salut" }));
    let html = "";
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !html.includes("Salut")) {
      html = await (await get("/console/fr/about")).text();
    }
    expect(html).toContain("Locale fr from url: Salut");
  }, 60_000);

  it("redirects a page URL without a locale to the visitor's", async () => {
    const detected = await get("/console/about", { "accept-language": "fr" });
    expect(detected.status).toBe(307);
    expect(detected.headers.get("location")).toBe("/console/fr/about");
    expect(detected.headers.get("vary")).toContain("Accept-Language");
  }, 60_000);

  it("reads the locale in route handlers, which keep their URL", async () => {
    const api = await get("/api/locale", { "accept-language": "fr" });
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ locale: "fr" });
    expect(api.headers.get("vary")).toContain("Accept-Language");
  }, 60_000);

  it("sends redirect() to the target in the request's locale", async () => {
    const redirected = await get("/console/fr/go");
    expect(redirected.status).toBe(307);
    expect(redirected.headers.get("location")).toBe("/console/fr/about");
  }, 60_000);
});
