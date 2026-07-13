// @vitest-environment node

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerRenderer } from "../server/renderer";
import type { FarmConfig, FarmRequest, FarmResponse, LoadingProps, ErrorProps } from "../types";
import { logger } from "../utils";

type MockResponse = FarmResponse & {
  body: string;
  headers: Map<string, string | number | readonly string[]>;
};

const routeModulePath = "/test/src/app/dashboard/page.tsx";
const loadingModulePath = "/test/src/app/dashboard/loading.tsx";
const errorModulePath = "/test/src/app/dashboard/error.tsx";
const ogImageModulePath = "/test/src/app/dashboard/opengraph-image.tsx";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("file route loading.tsx and error.tsx", () => {
  it("renders the nearest loading.tsx while a file route suspends", async () => {
    const release = createDeferred<void>();
    const response = createMockResponse();
    const renderer = createRenderer({
      [routeModulePath]: {
        default: async function DashboardPage() {
          await release.promise;
          return React.createElement("main", null, "Dashboard ready");
        },
      },
      [loadingModulePath]: {
        default: function DashboardLoading(props: LoadingProps) {
          return React.createElement(
            "p",
            null,
            `Loading dashboard ${props.path} ${props.search?.tab}`,
          );
        },
      },
    });

    const renderPromise = renderer.renderPage(createMockRequest("/dashboard?tab=stats"), response);
    await waitFor(() => response.body.includes("Loading dashboard /dashboard stats"));

    release.resolve();
    await renderPromise;

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Loading dashboard /dashboard stats");
    expect(response.body).toContain("Dashboard ready");
    expect(response.body).toContain("__FARM_LOADING_MODULE__");
    expect(response.body).toContain("/src/app/dashboard/loading.tsx");
  });

  it("renders the nearest error.tsx for file route render failures", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const response = createMockResponse();
    const renderer = createRenderer({
      [routeModulePath]: {
        default: function DashboardPage() {
          throw new Error("dashboard exploded");
        },
      },
      [errorModulePath]: {
        default: function DashboardError(props: ErrorProps) {
          const message = props.error instanceof Error ? props.error.message : String(props.error);
          return React.createElement(
            "section",
            null,
            `Dashboard error ${message} ${props.path} ${props.search?.tab}`,
          );
        },
      },
    });

    await renderer.renderPage(createMockRequest("/dashboard?tab=stats"), response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain("Dashboard error dashboard exploded /dashboard stats");
    expect(response.body).not.toContain("Internal Server Error");
  });

  it("renders generated metadata and route image file tags", async () => {
    const response = createMockResponse();
    const renderer = createRenderer(
      {
        [routeModulePath]: {
          metadata: {
            description: "Dashboard overview",
            openGraph: {
              siteName: "Farm",
            },
          },
          async generateMetadata(props: any) {
            const search = await props.searchParams;
            return {
              title: `Dashboard ${search.tab}`,
              openGraph: {
                title: "Dashboard stats",
              },
            };
          },
          default: function DashboardPage() {
            return React.createElement("main", null, "Dashboard ready");
          },
        },
        [ogImageModulePath]: {
          size: { width: 1200, height: 630 },
          alt: "Dashboard preview",
          default: function DashboardImage() {
            return React.createElement(
              "svg",
              { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 1200 630" },
              React.createElement("text", null, "Dashboard OG"),
            );
          },
        },
      },
      { opengraphImage: true },
    );

    await renderer.renderPage(createMockRequest("/dashboard?tab=stats"), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<title>Dashboard stats</title>");
    expect(response.body).toContain('<meta name="description" content="Dashboard overview">');
    expect(response.body).toContain('<meta property="og:title" content="Dashboard stats">');
    expect(response.body).toContain('<meta property="og:site_name" content="Farm">');
    expect(response.body).toContain(
      '<meta property="og:image" content="/dashboard/opengraph-image">',
    );
    expect(response.body).toContain('<meta property="og:image:width" content="1200">');
    expect(response.body).toContain('<meta property="og:image:alt" content="Dashboard preview">');
  });

  it("serves opengraph-image.tsx as a metadata image endpoint", async () => {
    const response = createMockResponse();
    const renderer = createRenderer(
      {
        [routeModulePath]: {
          default: function DashboardPage() {
            return React.createElement("main", null, "Dashboard ready");
          },
        },
        [ogImageModulePath]: {
          contentType: "image/svg+xml",
          default: function DashboardImage(props: any) {
            return React.createElement(
              "svg",
              { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 1200 630" },
              React.createElement("text", null, `OG ${props.path}`),
            );
          },
        },
      },
      { opengraphImage: true },
    );

    await renderer.renderPage(createMockRequest("/dashboard/opengraph-image"), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.body).toContain("<svg");
    expect(response.body).toContain("OG /dashboard");
  });

  it("embeds the deployment identity in document responses", async () => {
    const response = createMockResponse();
    const renderer = createRenderer({
      [routeModulePath]: {
        default: function DashboardPage() {
          return React.createElement("main", null, "Dashboard ready");
        },
      },
    });

    await renderer.renderPage(createMockRequest("/dashboard"), response);

    expect(response.headers.get("x-farm-deployment-id")).toBe("release-2");
    expect(response.headers.get("set-cookie")).toContain("__farm_deployment=release-2");
    expect(response.body).toContain('window.__FARM_DEPLOYMENT_ID__ = "release-2"');
    expect(response.body).toContain('<meta name="farm-deployment-id" content="release-2">');
  });
});

function createRenderer(modules: Record<string, any>, options: { opengraphImage?: boolean } = {}) {
  const metadataImageEntry = {
    pattern: "/dashboard",
    modulePath: ogImageModulePath,
    kind: "opengraph",
    fileName: "opengraph-image",
    route: {
      segments: [
        {
          segment: "dashboard",
          isDynamic: false,
          isCatchAll: false,
          isOptional: false,
        },
      ],
    },
  };
  const routeManager = {
    matchMetadataImage(pathname: string) {
      if (!options.opengraphImage || pathname !== "/dashboard/opengraph-image") {
        return null;
      }

      return {
        image: metadataImageEntry,
        params: {},
        pagePath: "/dashboard",
      };
    },
    matchRoute() {
      return {
        route: {
          pattern: "/dashboard",
          modulePath: routeModulePath,
        },
        params: {},
        layouts: [],
      };
    },
    getMatchingLoading() {
      return modules[loadingModulePath]
        ? {
            pattern: "/dashboard",
            modulePath: loadingModulePath,
          }
        : null;
    },
    getMatchingError() {
      return modules[errorModulePath]
        ? {
            pattern: "/dashboard",
            modulePath: errorModulePath,
          }
        : null;
    },
    getMatchingMetadataImage(_pathname: string, kind: string) {
      if (!options.opengraphImage || kind !== "opengraph") {
        return null;
      }

      return {
        image: metadataImageEntry,
        params: {},
      };
    },
    resolveMetadataImagePath() {
      return "/dashboard/opengraph-image";
    },
    async loadRouteModule(modulePath: string) {
      const mod = modules[modulePath];
      if (!mod) throw new Error(`Unknown module ${modulePath}`);
      return mod;
    },
    async loadLayoutModule(modulePath: string) {
      const mod = modules[modulePath];
      if (!mod) throw new Error(`Unknown layout ${modulePath}`);
      return mod;
    },
    generateClientManifest() {
      return {
        routes: [
          {
            pattern: "/dashboard",
            modulePath: "/src/app/dashboard/page.tsx",
            shouldHydrate: false,
            isClientComponent: false,
            segments: [{ segment: "dashboard", isDynamic: false }],
          },
        ],
        layouts: [],
      };
    },
  };

  return new ServerRenderer(createConfig(), routeManager as any);
}

function createConfig(): Required<FarmConfig> {
  return {
    root: "/test",
    srcDir: "src",
    outDir: "dist",
    basePath: "/",
    preset: "node-server",
    deploy: {},
    storage: {},
    integrations: {},
    migrations: { commands: [] },
    workflows: {
      enabled: false,
      workflows: [],
      tasks: {},
      scheduledTasks: {},
      route: "/api/workflows",
    } as any,
    env: { server: {}, public: {} },
    middleware: {},
    routeRules: {},
    docs: { enabled: false } as any,
    md: {} as any,
    mdx: { markdownRoutes: true, className: "farm-markdown" } as any,
    observability: false,
    suppressLintOnLink: false,
    deploymentId: "release-2",
    generateBuildId: () => "release-2",
    experimental: {
      serverComponents: false,
      serverActions: false,
    },
    vite: {},
  } as Required<FarmConfig>;
}

function createMockRequest(url: string): FarmRequest {
  return {
    url,
    method: "GET",
    headers: {
      host: "farm.test",
    },
  } as FarmRequest;
}

function createMockResponse(): MockResponse {
  const response = {
    statusCode: 200,
    body: "",
    headers: new Map<string, string | number | readonly string[]>(),
    headersSent: false,
    writableEnded: false,
    setHeader(key: string, value: string | number | readonly string[]) {
      this.headers.set(key.toLowerCase(), value);
      return this;
    },
    getHeader(key: string) {
      return this.headers.get(key.toLowerCase());
    },
    write(
      chunk: unknown,
      _encoding?: BufferEncoding | ((error?: Error | null) => void),
      cb?: (error?: Error | null) => void,
    ) {
      this.headersSent = true;
      this.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "");
      const callback = typeof _encoding === "function" ? _encoding : cb;
      callback?.();
      return true;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) {
        this.write(chunk);
      }
      this.writableEnded = true;
      return this;
    },
    flush() {},
    json(data: any) {
      this.setHeader("Content-Type", "application/json");
      this.end(JSON.stringify(data));
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    redirect(url: string, status = 302) {
      this.statusCode = status;
      this.setHeader("Location", url);
      this.end();
    },
  };

  return response as unknown as MockResponse;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(assertion: () => boolean, timeoutMs = 1000) {
  const start = Date.now();
  while (!assertion()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for assertion");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
