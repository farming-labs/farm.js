import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import viteRsc from "@vitejs/plugin-rsc";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import farmRsc from "./index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The development half of the contracts core-external.test.ts checks in a production build: a
 * Vite dev server running the RSC entry under basePath "/console" with trailingSlash.
 */
describe("RSC development server: trailingSlash and agent files", () => {
  let fixtureRoot: string;
  let server: ViteDevServer;
  let origin: string;

  beforeAll(async () => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-dev-agent-files-"));
    const writeRoute = (file: string, source: string) => {
      const target = path.join(fixtureRoot, "src", file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source);
    };
    writeFileSync(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({ name: "rsc-dev-agent-files", private: true, type: "module" }),
    );
    writeRoute(
      "layout.tsx",
      `export const metadata = { title: "Dev Shop" };
export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
    );
    writeRoute("page.tsx", `export default function Page() { return <main>Dev home</main>; }`);
    writeRoute(
      "about/page.tsx",
      `export const metadata = { title: "About" };
export default function Page() { return <main>Dev about</main>; }`,
    );
    // Nested under app/<basePath>/, as RSC apps had to write pages before.
    writeRoute(
      "console/legacy/page.tsx",
      `export default function Page() { return <main>Dev legacy</main>; }`,
    );
    writeRoute(
      "links/page.tsx",
      `import { Link } from "@farm.js/core/client";
export default function Page() { return <Link href="/about">About link</Link>; }`,
    );
    for (const packageName of [
      "@farm.js/core",
      "@vitejs/plugin-rsc",
      "better-call",
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
      const target = path.join(fixtureRoot, "node_modules", packageName);
      mkdirSync(path.dirname(target), { recursive: true });
      symlinkSync(realpathSync(source), target, process.platform === "win32" ? "junction" : "dir");
    }

    server = await createServer({
      root: fixtureRoot,
      configFile: false,
      logLevel: "silent",
      srcDir: "src",
      basePath: "/console",
      trailingSlash: true,
      experimental: { serverComponents: true },
      server: { host: "127.0.0.1", port: 0, strictPort: false },
      plugins: [
        ...farmRsc({ routesDir: "" }).filter(
          (plugin) => plugin.name !== "@farm.js/plugin/rsc:nitro-build",
        ),
        ...viteRsc({
          serverHandler: false,
          entries: {
            rsc: "./.farm/rsc-entries/entry.rsc.tsx",
            ssr: "./.farm/rsc-entries/entry.ssr.tsx",
            client: "./.farm/rsc-entries/entry.browser.tsx",
          },
        }),
      ],
    } as never);
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address !== "object") throw new Error("Dev server did not listen");
    origin = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("redirects to the trailing-slash URL and renders links with it", async () => {
    for (const [pathname, location] of [
      ["/console/about?tab=1", "/console/about/?tab=1"],
      ["/console", "/console/"],
      ["/console/about.rsc", "/console/about/index.rsc"],
    ]) {
      const response = await fetch(origin + pathname, { redirect: "manual" });
      expect(response.status, pathname).toBe(308);
      expect(response.headers.get("location"), pathname).toBe(location);
    }
    const about = await fetch(origin + "/console/about/");
    expect(about.status).toBe(200);
    const html = await about.text();
    expect(html).toContain("Dev about");
    // The head advertises the page's Markdown mirror, as the Link header does.
    expect(html).toContain('<link rel="alternate" href="/console/about.md" type="text/markdown">');
    const payload = await fetch(origin + "/console/about/index.rsc");
    expect(payload.headers.get("content-type")).toContain("text/x-component");
    expect(await (await fetch(origin + "/console/links/")).text()).toContain(
      'href="/console/about/"',
    );
    // A Markdown mirror reads its page at the canonical URL.
    const markdown = await fetch(origin + "/console/about.md");
    expect(markdown.status).toBe(200);
    expect(await markdown.text()).toContain("Dev about");
  }, 60_000);

  it("serves llms.txt and sitemap.xml below the basePath with public URLs", async () => {
    const llms = await fetch(origin + "/console/llms.txt");
    expect(llms.status).toBe(200);
    const list = await llms.text();
    for (const url of ["/console/index.md", "/console/about.md", "/console/legacy.md"]) {
      expect(list, url).toContain(`(${origin}${url})`);
    }
    const sitemap = await fetch(origin + "/console/sitemap.xml");
    expect(sitemap.status).toBe(200);
    const xml = await sitemap.text();
    // Each page at the URL it answers at, so none of them meets the trailing-slash 308.
    for (const url of ["/console/", "/console/about/", "/console/legacy/"]) {
      expect(xml, url).toContain(`<loc>${origin}${url}</loc>`);
      expect((await fetch(origin + url, { redirect: "manual" })).status, url).toBe(200);
    }
    expect(xml).toContain("<lastmod>");
  }, 60_000);
});
