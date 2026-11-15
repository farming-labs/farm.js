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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import farmRsc from "./index.js";
import { METADATA_TEST_PNG } from "./test-fixture-dependencies.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The development half of the metadata file contract core-external.test.ts checks in a production
 * build: manifest.ts, static and generated opengraph-image/twitter-image files under basePath
 * "/console" with trailingSlash, served by a Vite dev server running the RSC entry.
 */
describe("RSC development server: manifest.ts and metadata images", () => {
  let fixtureRoot: string;
  let server: ViteDevServer;
  let origin: string;
  const writeRoute = (file: string, source: string | Buffer) => {
    const target = path.join(fixtureRoot, "src", file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  };

  beforeAll(async () => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-dev-metadata-files-"));
    writeFileSync(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({ name: "rsc-dev-metadata-files", private: true, type: "module" }),
    );
    writeRoute(
      "layout.tsx",
      `export const metadata = { title: "Dev Shop" };
export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
    );
    writeRoute("page.tsx", `export default function Page() { return <main>Dev home</main>; }`);
    writeRoute(
      "explicit/page.tsx",
      `export const metadata = {
  manifest: "/custom.webmanifest",
  openGraph: { images: ["https://cdn.example/og.png"] },
};
export default function Page() { return <main>Explicit</main>; }`,
    );
    writeRoute(
      "products/[id]/reviews/page.tsx",
      `export default function Page({ params }) { return <main>Reviews {params.id}</main>; }`,
    );
    writeRoute(
      "manifest.ts",
      `export default function manifest() {
  return { name: "Dev Shop", start_url: "/console/", display: "standalone" };
}`,
    );
    writeRoute("opengraph-image.png", METADATA_TEST_PNG);
    writeRoute("opengraph-image.alt.txt", "Dev Shop preview\n");
    writeRoute("twitter-image.png", METADATA_TEST_PNG);
    writeRoute(
      "products/[id]/opengraph-image.tsx",
      `export const size = { width: 600, height: 315 };
export const alt = "Product preview";
export const revalidate = 300;
export default async function Image({ params, path }) {
  return <div style={{ display: "flex", width: "100%", height: "100%" }}>Product {params.id} at {path}</div>;
}`,
    );
    for (const packageName of [
      "@farm.js/core",
      "@vercel/og",
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
        path.resolve(packageRoot, "../farm/node_modules", packageName),
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

  it("adds the nearest manifest and images to the page head, below the basePath", async () => {
    const home = await fetch(origin + "/console/");
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain('<link rel="manifest" href="/console/manifest.webmanifest">');
    const ogImage = html.match(/<meta property="og:image" content="([^"]+)">/)?.[1];
    expect(ogImage).toMatch(/^\/console\/opengraph-image\?v=[0-9a-f]{16}$/);
    expect(html).toContain('<meta property="og:image:width" content="1">');
    expect(html).toContain('<meta property="og:image:alt" content="Dev Shop preview">');
    expect(html).toContain('<meta property="og:image:type" content="image/png">');
    expect(html).toMatch(
      /<meta name="twitter:image" content="\/console\/twitter-image\?v=[0-9a-f]{16}">/,
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');

    // A nested page takes the nearest segment's generated image, with its params.
    const reviews = await (await fetch(origin + "/console/products/42/reviews/")).text();
    expect(reviews).toContain(
      '<meta property="og:image" content="/console/products/42/opengraph-image">',
    );
    expect(reviews).toContain('<meta property="og:image:width" content="600">');
    expect(reviews).toContain('<meta property="og:image:alt" content="Product preview">');
    expect(reviews).toMatch(/twitter:image" content="\/console\/twitter-image\?v=/);

    // Explicit metadata wins over the files.
    const explicit = await (await fetch(origin + "/console/explicit/")).text();
    expect(explicit).toContain('<link rel="manifest" href="/custom.webmanifest">');
    expect(explicit).toContain('<meta property="og:image" content="https://cdn.example/og.png">');
    expect(explicit).not.toContain("/console/opengraph-image");
  }, 60_000);

  it("never hands a browser a file through the metadata image query", async () => {
    // A file of the app, and an image named like a route image outside the app.
    writeFileSync(path.join(fixtureRoot, "secret.txt"), "TOP-SECRET-VALUE");
    writeFileSync(path.join(fixtureRoot, "src", "secret.txt"), "TOP-SECRET-VALUE");
    const outside = mkdtempSync(path.join(tmpdir(), "farm-rsc-dev-metadata-outside-"));
    writeFileSync(path.join(outside, "opengraph-image.png"), METADATA_TEST_PNG);
    // Vite serves an app file itself (with or without the query), so only an encoded copy of
    // one, which only the metadata image loader would produce, is a leak through the query.
    const encodedLeaks = [
      Buffer.from("TOP-SECRET-VALUE").toString("base64"),
      METADATA_TEST_PNG.toString("base64"),
    ];
    try {
      for (const pathname of [
        "/secret.txt?farm-metadata-image",
        "/src/secret.txt?farm-metadata-image",
        "/package.json?farm-metadata-image",
        `/@fs${fixtureRoot}/secret.txt?farm-metadata-image`,
        `/@fs${outside}/opengraph-image.png?farm-metadata-image`,
        // A route image too: the browser never gets the loader's module.
        "/src/opengraph-image.png?farm-metadata-image",
        `/@fs${fixtureRoot}/src/opengraph-image.png?farm-metadata-image`,
        "/secret.txt?farm-metadata-image&import",
        "/src/opengraph-image.png?farm-metadata-image&import",
        `/@fs${fixtureRoot}/secret.txt?farm-metadata-image&import`,
        `/@fs${outside}/opengraph-image.png?farm-metadata-image&import`,
        `/@fs${fixtureRoot}/src/opengraph-image.png?import&farm-metadata-image`,
      ]) {
        const response = await fetch(origin + pathname);
        const body = await response.text();
        // Source maps the dev server inlines, decoded, so an encoded copy is caught too.
        const decoded = [...body.matchAll(/base64,([A-Za-z0-9+/=]+)/g)]
          .map((match) => Buffer.from(match[1], "base64").toString())
          .join("\n");
        // Never the loader's module: the file's info and bytes as JavaScript.
        expect(body, pathname).not.toContain('"info":');
        for (const leak of encodedLeaks) {
          expect(body + decoded, pathname).not.toContain(leak);
        }
        // Outside fs.allow, the query does not get the image past Vite's 403.
        if (pathname.includes(outside)) {
          expect(body + decoded, pathname).not.toContain("PNG");
        }
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  }, 60_000);

  it("serves manifest.ts at manifest.webmanifest", async () => {
    const manifest = await fetch(origin + "/console/manifest.webmanifest");
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toBe("application/manifest+json; charset=utf-8");
    expect(manifest.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(await manifest.json()).toEqual({
      name: "Dev Shop",
      start_url: "/console/",
      display: "standalone",
    });
    expect((await fetch(origin + "/console/manifest.webmanifest", { method: "POST" })).status).toBe(
      405,
    );
  }, 60_000);

  it("serves static images with core's caching and conditional requests", async () => {
    const html = await (await fetch(origin + "/console/")).text();
    const href = html.match(/<meta property="og:image" content="([^"]+)">/)![1];
    const versioned = await fetch(origin + href);
    expect(versioned.status).toBe(200);
    expect(versioned.headers.get("content-type")).toBe("image/png");
    expect(versioned.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(Buffer.from(await versioned.arrayBuffer())).toEqual(METADATA_TEST_PNG);
    const etag = versioned.headers.get("etag")!;
    expect(etag).toBe(`"${href.split("?v=")[1]}"`);

    const unversioned = await fetch(origin + "/console/opengraph-image");
    expect(unversioned.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    const notModified = await fetch(origin + "/console/opengraph-image", {
      headers: { "if-none-match": etag },
    });
    expect(notModified.status).toBe(304);
    const head = await fetch(origin + "/console/twitter-image", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(METADATA_TEST_PNG.byteLength));
    expect((await fetch(origin + "/console/opengraph-image", { method: "POST" })).status).toBe(405);
  }, 60_000);

  it("renders a generated image as a PNG with its params and revalidate", async () => {
    const image = await fetch(origin + "/console/products/42/opengraph-image");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=300",
    );
    const bytes = Buffer.from(await image.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    // 600x315, from the module's size export.
    expect(bytes.readUInt32BE(16)).toBe(600);
    expect(bytes.readUInt32BE(20)).toBe(315);
    // No twitter-image module: the request falls through to the router's 404.
    expect((await fetch(origin + "/console/products/42/twitter-image")).status).toBe(404);
  }, 60_000);

  // Run last: they change the files the tests above read.
  it("reloads a static image's alt text when it changes", async () => {
    writeRoute("opengraph-image.alt.txt", "Edited preview\n");
    await vi.waitFor(
      async () => {
        const html = await (await fetch(origin + "/console/")).text();
        expect(html).toContain('<meta property="og:image:alt" content="Edited preview">');
      },
      { timeout: 20_000, interval: 250 },
    );
  }, 60_000);

  it("picks up an image added while it runs", async () => {
    writeRoute(
      "products/[id]/twitter-image.tsx",
      `export const contentType = "image/svg+xml";
export default ({ params }) => '<svg xmlns="http://www.w3.org/2000/svg">' + params.id + '</svg>';`,
    );
    await vi.waitFor(
      async () => {
        const image = await fetch(origin + "/console/products/7/twitter-image");
        expect(image.status).toBe(200);
        expect(image.headers.get("content-type")).toBe("image/svg+xml");
        expect(await image.text()).toBe('<svg xmlns="http://www.w3.org/2000/svg">7</svg>');
        const reviews = await (await fetch(origin + "/console/products/7/reviews/")).text();
        expect(reviews).toContain(
          '<meta name="twitter:image" content="/console/products/7/twitter-image">',
        );
      },
      { timeout: 20_000, interval: 250 },
    );
  }, 60_000);
});
