import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFarmMetadataImageResponse } from "@farm.js/core/internal/metadata-image-runtime";
import {
  addMetadataImageReference,
  applyFarmBasePath,
  compareRouteSpecificity,
  createFarmMetadataRouteResponse,
  createFarmSearchParams,
  getRoutePatternSpecificity,
  localizeFarmHref,
  matchesFarmIfNoneMatch,
  matchFarmPageRoute,
  parseRoutePath,
  resolveFarmI18nConfig,
  searchParamsToObject,
  stripFarmBasePath,
  stripFarmLocaleFromPathname,
} from "@farm.js/core/internal/production-runtime";
import farmRsc from "../index.js";
import { linkRscFixtureDependencies, METADATA_TEST_PNG } from "../test-fixture-dependencies.js";
import type { EntryContext } from "../types.js";
import { FARM_METADATA_IMAGE_QUERY, generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/console",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1024 * 1024 } as never,
  deploymentId: "metadata-files-test",
  debug: false,
};
const allFiles = { appMetadataRoutes: true, metadataImages: { static: true, generated: true } };

const fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-metadata-files-"));
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function slice(entry: string, startMarker: string, endMarker: string): string {
  const start = entry.indexOf(startMarker);
  const end = entry.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return entry.slice(start, end);
}

/** The loader plugin of an app at `appRoot` (routes in src/), configured as farm dev does. */
async function createLoader(appRoot: string) {
  mkdirSync(path.join(appRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(appRoot, "package.json"),
    JSON.stringify({ name: "app", type: "module" }),
  );
  writeFileSync(path.join(appRoot, "src", "page.tsx"), "export default () => null;");
  linkRscFixtureDependencies(appRoot);
  const plugins = farmRsc({ routesDir: "" });
  await (
    plugins.find((plugin) => plugin.name === "@farm.js/plugin/rsc:config")!.config as (
      config: Record<string, unknown>,
      env: { command: "serve"; mode: string },
    ) => Promise<unknown>
  )(
    { root: appRoot, srcDir: "src", experimental: { serverComponents: true } },
    { command: "serve", mode: "development" },
  );
  const loader = plugins.find((plugin) => plugin.name === "@farm.js/plugin/rsc:metadata-images");
  return (id: string, environment = "rsc", watched: string[] = []) =>
    (loader!.load as (this: unknown, id: string) => Promise<string | null>).call(
      { environment: { name: environment }, addWatchFile: (file: string) => watched.push(file) },
      id,
    );
}

const loaderAppRoot = path.join(fixtureRoot, "loader-app");
let loadMetadataImage: Awaited<ReturnType<typeof createLoader>> | undefined;

/** The plugin's loader for a static image file of the app's routes, as the entry imports it. */
async function loadStaticImage(file: string, alt?: string) {
  loadMetadataImage ??= await createLoader(loaderAppRoot);
  const target = path.join(loaderAppRoot, "src", file);
  writeFileSync(target, METADATA_TEST_PNG);
  if (alt !== undefined) writeFileSync(target.replace(/\.png$/, ".alt.txt"), alt);
  const watched: string[] = [];
  const code = await loadMetadataImage(target + FARM_METADATA_IMAGE_QUERY, "rsc", watched);
  expect(watched).toEqual([target, target.replace(/\.png$/, ".alt.txt")]);
  return JSON.parse(code!.replace(/^export default /, "").replace(/;$/, ""));
}

/** Runs the generated metadata file code with core's real helpers. */
function createRuntime(options: {
  basePath?: string;
  locale?: string;
  routes?: Record<string, Record<string, unknown>>;
  modules?: Record<string, Record<string, unknown>>;
  files?: Record<string, unknown>;
}) {
  const basePath = options.basePath ?? "/console";
  const i18n = options.locale
    ? resolveFarmI18nConfig({ locales: ["en", "fr"], defaultLocale: "en" }, { basePath })
    : undefined;
  const entry = generateRscEntry({
    ...context,
    ...allFiles,
    basePath,
    ...(i18n ? { i18n, i18nCatalogs: { en: {}, fr: {} } } : {}),
  });
  const helper = slice(entry, "const farmRouteI18n = ", "\n}\n") + "\n}\n";
  return new Function(
    "appMetadataRoutes0",
    "metadataImageModules0",
    "metadataImageFiles0",
    "parseRoutePath",
    "getRoutePatternSpecificity",
    "compareRouteSpecificity",
    "matchFarmPageRoute",
    "stripFarmBasePath",
    "stripFarmLocaleFromPathname",
    "createFarmMetadataRouteResponse",
    "addMetadataImageReference",
    "matchesFarmIfNoneMatch",
    "createFarmSearchParams",
    "searchParamsToObject",
    "createFarmMetadataImageResponse",
    "applyFarmBasePath",
    "localizeFarmHref",
    "getFarmI18nClientSnapshot",
    `${helper}
${slice(entry, "function mergeRouteModules(", "function collectRouteModuleEntries(")}
${slice(entry, "const FARM_APP_METADATA_OUTPUTS = ", "/**\n * Serves a page's Markdown mirror")}
return { handleFarmAppMetadataRoute, handleFarmMetadataImageRequest, addFarmMetadataFileReferences };`,
  )(
    options.routes ?? {},
    options.modules ?? {},
    options.files ?? {},
    parseRoutePath,
    getRoutePatternSpecificity,
    compareRouteSpecificity,
    matchFarmPageRoute,
    stripFarmBasePath,
    stripFarmLocaleFromPathname,
    createFarmMetadataRouteResponse,
    addMetadataImageReference,
    matchesFarmIfNoneMatch,
    createFarmSearchParams,
    searchParamsToObject,
    createFarmMetadataImageResponse,
    applyFarmBasePath,
    localizeFarmHref,
    () => (i18n ? { ...i18n, locale: options.locale, direction: "ltr" } : null),
  ) as {
    handleFarmAppMetadataRoute(request: Request, context?: unknown): Promise<Response | null>;
    handleFarmMetadataImageRequest(request: Request): Promise<Response | null>;
    addFarmMetadataFileReferences(
      metadata: Record<string, any>,
      pathname: string,
    ): Record<string, any>;
  };
}

describe("RSC metadata files: generated code", () => {
  it("emits no code for a build without manifest.ts or metadata images", () => {
    const entry = generateRscEntry(context);
    expect(entry).not.toContain("handleFarmMetadataImageRequest");
    expect(entry).not.toContain("addFarmMetadataFileReferences");
    expect(entry).not.toContain("metadata-image-runtime");
    expect(entry).not.toContain("opengraph-image");
    expect(entry).not.toContain("manifest.webmanifest");
  });

  it("does not load the @vercel/og runtime for static images only", () => {
    const entry = generateRscEntry({
      ...context,
      metadataImages: { static: true, generated: false },
    });
    expect(entry).not.toContain("metadata-image-runtime");
    expect(entry).not.toContain("metadataImageModules0");
    expect(entry).toContain(
      `import.meta.glob("/src/app/**/{opengraph-image,twitter-image}.{png,jpg,jpeg,gif,webp}", { query: "${FARM_METADATA_IMAGE_QUERY}", import: 'default', eager: true })`,
    );
  });

  it("answers images after middleware and API routes, and adds them to the head", () => {
    const entry = generateRscEntry({ ...context, ...allFiles });
    expect(entry).toContain(
      "import { createFarmMetadataImageResponse } from '@farm.js/core/internal/metadata-image-runtime';",
    );
    expect(entry).toContain(
      'import.meta.glob("/src/app/**/{opengraph-image,twitter-image}.{tsx,jsx,ts,js}", { eager: true })',
    );
    expect(entry).toContain(
      'import.meta.glob("/src/app/**/{sitemap,robots,manifest,llms,llms-full}.{ts,js}", { eager: true })',
    );
    const middleware = entry.indexOf("await executeMiddleware(request, context)");
    const api = entry.indexOf("await handleAPIRequest(cloneFarmRequestWithContext(request))");
    const images = entry.indexOf("await handleFarmMetadataImageRequest(request)");
    const routeFiles = entry.indexOf("await handleFarmAppMetadataRoute(request, context)");
    expect(api).toBeGreaterThan(middleware);
    expect(images).toBeGreaterThan(api);
    expect(routeFiles).toBeGreaterThan(images);
    expect(entry).toContain(
      "addFarmMetadataFileReferences(await resolveFarmRouteMetadata(LayoutModules, pageModule, pageProps), url.pathname)",
    );
  });

  it("counts images and manifest.ts as local routes a config rewrite yields to", () => {
    const entry = generateRscEntry({
      ...context,
      ...allFiles,
      configRoutes: {
        redirects: [],
        rewrites: [{ source: "/opengraph-image", destination: "/about" }],
        headers: [],
      },
    });
    const localRoute = slice(entry, "function farmHasLocalRequestRoute(", "\n}\n");
    expect(localRoute).toContain("if (matchFarmMetadataImageRequest(routePathname)) return true;");
    expect(localRoute).toContain("if (matchFarmAppMetadataRoute(routePathname)) return true;");
  });
});

describe("RSC metadata files: runtime", () => {
  it("reads a static image as core's router does", async () => {
    const file = await loadStaticImage("opengraph-image.png", "Shop preview\n");
    expect(file.info).toMatchObject({
      extension: "png",
      contentType: "image/png",
      width: 1,
      height: 1,
      alt: "Shop preview",
      byteLength: METADATA_TEST_PNG.byteLength,
    });
    expect(file.info.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(Buffer.from(file.data, "base64")).toEqual(METADATA_TEST_PNG);
  });

  it("reads only the app's route images, and only for the RSC environment", async () => {
    await loadStaticImage("opengraph-image.png");
    const load = loadMetadataImage!;
    const routeImage = path.join(loaderAppRoot, "src", "opengraph-image.png");
    // A browser can send the query to the dev server: the client environment never reads a file.
    expect(await load(routeImage + FARM_METADATA_IMAGE_QUERY, "client")).toBeNull();
    expect(await load(routeImage + FARM_METADATA_IMAGE_QUERY, "ssr")).toBeNull();
    // Any other file, an image under another name, or a route-named image outside the routes.
    writeFileSync(path.join(loaderAppRoot, ".env"), "SECRET=1");
    writeFileSync(path.join(loaderAppRoot, "src", "logo.png"), METADATA_TEST_PNG);
    mkdirSync(path.join(fixtureRoot, "outside"), { recursive: true });
    writeFileSync(path.join(fixtureRoot, "outside", "opengraph-image.png"), METADATA_TEST_PNG);
    for (const file of [
      path.join(loaderAppRoot, ".env"),
      path.join(loaderAppRoot, "package.json"),
      path.join(loaderAppRoot, "src", "logo.png"),
      path.join(loaderAppRoot, "src", "page.tsx"),
      path.join(loaderAppRoot, "src", "..", "..", "outside", "opengraph-image.png"),
      path.join(fixtureRoot, "outside", "opengraph-image.png"),
    ]) {
      await expect(load(file + FARM_METADATA_IMAGE_QUERY), file).rejects.toThrow(
        /is not an opengraph-image or twitter-image file of the app's routes/,
      );
    }
    // Ids without the query are left to Vite.
    expect(await load(routeImage)).toBeNull();
    expect(await load(routeImage + "?farm-metadata-images")).toBeNull();
  });

  it("serves a static image with core's caching, ETag and methods", async () => {
    const file = await loadStaticImage("twitter-image.png");
    const runtime = createRuntime({ files: { "/src/app/(shop)/twitter-image.png": file } });
    const hash = file.info.hash;
    const versioned = await runtime.handleFarmMetadataImageRequest(
      new Request(`http://shop.test/console/twitter-image?v=${hash}`),
    );
    expect(versioned!.status).toBe(200);
    expect(versioned!.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(versioned!.headers.get("etag")).toBe(`"${hash}"`);
    expect(versioned!.headers.get("content-length")).toBe(String(METADATA_TEST_PNG.byteLength));
    expect(versioned!.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await versioned!.arrayBuffer())).toEqual(METADATA_TEST_PNG);
    // At the origin root too, with a trailing slash, as core matches the route path.
    const unversioned = await runtime.handleFarmMetadataImageRequest(
      new Request("http://shop.test/twitter-image/"),
    );
    expect(unversioned!.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    const notModified = await runtime.handleFarmMetadataImageRequest(
      new Request("http://shop.test/console/twitter-image", {
        headers: { "if-none-match": `"${hash}"` },
      }),
    );
    expect(notModified!.status).toBe(304);
    const head = await runtime.handleFarmMetadataImageRequest(
      new Request("http://shop.test/console/twitter-image", { method: "HEAD" }),
    );
    expect(await head!.text()).toBe("");
    const post = await runtime.handleFarmMetadataImageRequest(
      new Request("http://shop.test/console/twitter-image", { method: "POST" }),
    );
    expect(post!.status).toBe(405);
    expect(post!.headers.get("allow")).toBe("GET, HEAD");
    expect(
      await runtime.handleFarmMetadataImageRequest(
        new Request("http://shop.test/console/opengraph-image"),
      ),
    ).toBeNull();
  });

  it("renders a generated image with its segment's params, search params and path", async () => {
    const calls: unknown[] = [];
    const runtime = createRuntime({
      modules: {
        "/src/app/products/[id]/opengraph-image.tsx": {
          contentType: "image/svg+xml",
          revalidate: 60,
          default: (props: { params: { id: string }; searchParams: unknown; path: string }) => {
            calls.push(props);
            return `<svg>${props.params.id}</svg>`;
          },
        },
        "/src/app/broken/opengraph-image.tsx": {},
      },
    });
    const response = await runtime.handleFarmMetadataImageRequest(
      new Request("http://shop.test/console/products/42/opengraph-image?tab=a&tab=b"),
    );
    expect(response!.status).toBe(200);
    expect(response!.headers.get("content-type")).toBe("image/svg+xml");
    expect(response!.headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    expect(await response!.text()).toBe("<svg>42</svg>");
    expect(calls).toEqual([
      { params: { id: "42" }, searchParams: expect.anything(), path: "/products/42" },
    ]);
    expect((calls[0] as { searchParams: Record<string, unknown> }).searchParams.tab).toEqual([
      "a",
      "b",
    ]);
    const broken = await runtime.handleFarmMetadataImageRequest(
      new Request("http://shop.test/console/broken/opengraph-image"),
    );
    expect(broken!.status).toBe(500);
  });

  it("serves manifest.ts as core serves it", async () => {
    const runtime = createRuntime({
      routes: {
        "/src/app/manifest.ts": { default: () => ({ name: "Shop", display: "standalone" }) },
      },
    });
    const response = await runtime.handleFarmAppMetadataRoute(
      new Request("http://shop.test/console/manifest.webmanifest"),
    );
    expect(response!.status).toBe(200);
    expect(response!.headers.get("content-type")).toBe("application/manifest+json; charset=utf-8");
    expect(await response!.json()).toEqual({ name: "Shop", display: "standalone" });
  });

  it("adds the nearest manifest and images to the metadata unless it sets them", async () => {
    const file = await loadStaticImage("opengraph-image.png", "Shop preview");
    const runtime = createRuntime({
      routes: {
        "/src/app/manifest.ts": { default: {} },
        "/src/app/docs/manifest.ts": { default: {} },
      },
      modules: {
        "/src/app/products/[id]/opengraph-image.tsx": {
          size: { width: 600, height: 315 },
          alt: "Product",
          default: () => null,
        },
        "/src/app/products/[id]/twitter-image.tsx": { default: () => null },
      },
      files: { "/src/app/opengraph-image.png": file },
    });
    const hash = file.info.hash;
    expect(runtime.addFarmMetadataFileReferences({ title: "Home" }, "/console/")).toEqual({
      title: "Home",
      manifest: "/console/manifest.webmanifest",
      openGraph: {
        images: [
          {
            url: `/console/opengraph-image?v=${hash}`,
            width: 1,
            height: 1,
            alt: "Shop preview",
            type: "image/png",
          },
        ],
      },
    });
    expect(runtime.addFarmMetadataFileReferences({}, "/console/docs/intro")).toMatchObject({
      manifest: "/console/docs/manifest.webmanifest",
    });
    expect(runtime.addFarmMetadataFileReferences({}, "/console/products/42/reviews")).toEqual({
      manifest: "/console/manifest.webmanifest",
      openGraph: {
        images: [
          {
            url: "/console/products/42/opengraph-image",
            width: 600,
            height: 315,
            alt: "Product",
            type: undefined,
          },
        ],
      },
      twitter: { images: ["/console/products/42/twitter-image"], card: "summary_large_image" },
    });
    const explicit = {
      manifest: "/app.webmanifest",
      openGraph: { images: ["https://cdn.example/og.png"] },
      twitter: { images: ["https://cdn.example/x.png"], card: "summary" },
    };
    expect(runtime.addFarmMetadataFileReferences(explicit, "/console/products/42")).toEqual(
      explicit,
    );
  });

  it("names files in the request's locale and answers at localized URLs", async () => {
    const file = await loadStaticImage("opengraph-image.png");
    const runtime = createRuntime({
      locale: "fr",
      routes: { "/src/app/manifest.ts": { default: {} } },
      files: { "/src/app/opengraph-image.png": file },
    });
    const metadata = runtime.addFarmMetadataFileReferences({}, "/console/fr/about");
    expect(metadata.manifest).toBe("/console/fr/manifest.webmanifest");
    expect(metadata.openGraph.images[0].url).toBe(
      `/console/fr/opengraph-image?v=${file.info.hash}`,
    );
    const image = await runtime.handleFarmMetadataImageRequest(
      new Request("http://shop.test/console/fr/opengraph-image"),
    );
    expect(image!.status).toBe(200);
    const manifest = await runtime.handleFarmAppMetadataRoute(
      new Request("http://shop.test/console/fr/manifest.webmanifest"),
    );
    expect(manifest!.status).toBe(200);
  });

  it("names files at the origin root without a basePath", async () => {
    const runtime = createRuntime({
      basePath: "/",
      routes: { "/src/app/manifest.ts": { default: {} } },
    });
    expect(runtime.addFarmMetadataFileReferences({}, "/about").manifest).toBe(
      "/manifest.webmanifest",
    );
  });
});

describe("RSC metadata files: build discovery", () => {
  /** Runs the plugin's config hook for a build of an app with these route files. */
  async function configureBuild(files: Record<string, string | Buffer>) {
    const root = mkdtempSync(path.join(fixtureRoot, "app-"));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", type: "module" }));
    linkRscFixtureDependencies(root);
    for (const [file, source] of Object.entries({
      "page.tsx": "export default () => null;",
      ...files,
    })) {
      const target = path.join(root, "src", file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    const configPlugin = farmRsc({ routesDir: "" }).find(
      (plugin) => plugin.name === "@farm.js/plugin/rsc:config",
    );
    await (
      configPlugin!.config as (
        config: Record<string, unknown>,
        env: { command: "build"; mode: string },
      ) => Promise<unknown>
    )(
      { root, srcDir: "src", experimental: { serverComponents: true } },
      { command: "build", mode: "production" },
    );
    return readFileSync(path.join(root, ".farm", "rsc-entries", "entry.rsc.tsx"), "utf8");
  }

  it("bundles manifest.ts and static images only when the app has them", async () => {
    const without = await configureBuild({});
    expect(without).not.toContain("handleFarmMetadataImageRequest");
    expect(without).not.toContain("handleFarmAppMetadataRoute");
    const entry = await configureBuild({
      "manifest.ts": "export default {};",
      "(shop)/opengraph-image.png": METADATA_TEST_PNG,
    });
    expect(entry).toContain("handleFarmAppMetadataRoute");
    expect(entry).toContain("metadataImageFiles0");
    expect(entry).not.toContain("metadata-image-runtime");
  });

  it("rejects two images of a kind for one route segment, as core does", async () => {
    await expect(
      configureBuild({
        "opengraph-image.png": METADATA_TEST_PNG,
        "(shop)/opengraph-image.tsx": "export default () => null;",
      }),
    ).rejects.toThrow(/Duplicate opengraph-image route "\/"/);
  });
});
