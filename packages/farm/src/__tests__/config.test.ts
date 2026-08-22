// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defineConfig,
  defineFarmConfig,
  loadConfig,
  resolveConfig,
  detectPlatformDeployTarget,
  resolveDeployConfig,
  resolveDocsConfig,
  resolveMigrationsConfig,
} from "../config";
import { getResolvedEnv, setEnv } from "../env";
import { routeRulesToNitroRouteRules } from "../route-rules";

const originalEnv = { ...process.env };

afterEach(() => {
  setEnv({ server: {}, public: {} });

  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
});

describe("config helpers", () => {
  it("keeps defineFarmConfig as an exact compatibility alias", () => {
    const config = {
      srcDir: "app",
      deploy: { target: "vercel" as const },
    };

    expect(defineConfig).toBe(defineFarmConfig);
    expect(defineConfig(config)).toBe(config);
    expect(defineFarmConfig(config)).toBe(config);
  });

  it("preserves a configured cache adapter and namespace", async () => {
    const adapter = {
      name: "test-cache",
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };

    const config = await resolveConfig(
      {
        cache: {
          adapter,
          namespace: "catalog",
        },
      },
      "production",
    );

    expect(config.cache).toEqual({
      adapter,
      namespace: "catalog",
    });
  });

  it("resolves smart preload budgets", async () => {
    const defaults = await resolveConfig({}, "production");
    const configured = await resolveConfig(
      {
        performance: {
          preload: { mode: "warn", maxImages: 2, maxFonts: 1 },
        },
      },
      "production",
    );

    expect(defaults.performance).toEqual({
      preload: { mode: "enforce", maxImages: 1, maxFonts: 2 },
    });
    expect(configured.performance).toEqual({
      preload: { mode: "warn", maxImages: 2, maxFonts: 1 },
    });
  });
});

describe("loadConfig", () => {
  it("uses a preloaded environment reader when provided", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-config-env-loader-"));
    const loadEnvironment = vi.fn(() => ({ FARM_PRELOADED_ENV: "ready" }));
    await fs.writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { value: process.env.FARM_PRELOADED_ENV };",
    );

    const config = await loadConfig(
      root,
      undefined,
      "production",
      loadEnvironment as (typeof import("vite"))["loadEnv"],
    );

    expect(loadEnvironment).toHaveBeenCalledWith("production", root, "");
    expect(config).toMatchObject({ value: "ready" });
  });

  it("throws when an explicitly supplied config path does not exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-config-missing-"));
    // A default config exists, but the explicit path must not fall back to it.
    await fs.writeFile(path.join(root, "farm.config.mjs"), "export default { value: 'default' };");

    await expect(loadConfig(root, "farm.config.prod.ts", "production")).rejects.toThrow(
      "Config file not found at farm.config.prod.ts",
    );
  });

  it("loads an explicitly supplied config path that exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-config-explicit-"));
    await fs.writeFile(path.join(root, "farm.config.mjs"), "export default { value: 'default' };");
    await fs.writeFile(path.join(root, "custom.config.mjs"), "export default { value: 'custom' };");

    const config = await loadConfig(root, "custom.config.mjs", "production");
    expect(config).toMatchObject({ value: "custom" });
  });

  it("loads env files before importing farm.config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-config-env-"));

    await fs.writeFile(
      path.join(root, ".env.local"),
      "CLERK_SECRET_KEY=from-local\nNEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=from-local-pk\n",
    );
    await fs.writeFile(
      path.join(root, "farm.config.mjs"),
      [
        "export default {",
        "  clerkSecretKey: process.env.CLERK_SECRET_KEY,",
        "  clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,",
        "};",
      ].join("\n"),
    );

    const config = await loadConfig(root, undefined, "development");

    expect(config).toMatchObject({
      root,
      clerkSecretKey: "from-local",
      clerkPublishableKey: "from-local-pk",
    });
    expect(process.env.CLERK_SECRET_KEY).toBe("from-local");
    expect(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBe("from-local-pk");
  });

  it("does not override existing process env values", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-config-env-"));
    process.env.CLERK_SECRET_KEY = "existing-value";

    await fs.writeFile(path.join(root, ".env.local"), "CLERK_SECRET_KEY=file-value\n");
    await fs.writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { clerkSecretKey: process.env.CLERK_SECRET_KEY };",
    );

    const config = await loadConfig(root, undefined, "development");

    expect(config).toMatchObject({
      clerkSecretKey: "existing-value",
    });
    expect(process.env.CLERK_SECRET_KEY).toBe("existing-value");
  });

  it("throws when a discovered config file fails to import", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-config-env-"));

    await fs.writeFile(
      path.join(root, "farm.config.mjs"),
      "throw new Error('broken config import');",
    );

    await expect(loadConfig(root, undefined, "development")).rejects.toThrow(
      "Failed to load config from farm.config.mjs: broken config import",
    );
  });

  it("loads farm.config.ts when it transitively imports local tsx modules", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-config-tsx-"));

    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "template.tsx"),
      ["export const previewProps = { subject: 'Hello from TSX' };"].join("\n"),
    );
    await fs.writeFile(
      path.join(root, "src", "integrations.ts"),
      [
        "import { previewProps } from './template.tsx';",
        "export const emailConfig = { previewSubject: previewProps.subject };",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(root, "farm.config.ts"),
      [
        "import { emailConfig } from './src/integrations.ts';",
        "export default { emailPreview: emailConfig.previewSubject };",
      ].join("\n"),
    );

    const config = await loadConfig(root, undefined, "development");

    expect(config).toMatchObject({
      emailPreview: "Hello from TSX",
    });
  });

  it("loads config.ts as a minimal config filename", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-config-alias-"));

    await fs.writeFile(
      path.join(root, "config.ts"),
      ["export default {", "  srcDir: 'src',", "  deploy: { target: 'vercel' },", "};"].join("\n"),
    );

    const config = await loadConfig(root, undefined, "development");

    expect(config).toMatchObject({
      srcDir: "src",
      deploy: { target: "vercel" },
    });
  });
});

describe("resolveConfig", () => {
  it('defaults srcDir to "src" and preserves an explicit override', async () => {
    const defaults = await resolveConfig({}, "development");
    const configured = await resolveConfig({ srcDir: "app" }, "development");

    expect(defaults.srcDir).toBe("src");
    expect(configured.srcDir).toBe("app");
  });

  it("keeps optimized boundaries disabled by default and preserves explicit opt-in", async () => {
    const defaults = await resolveConfig({}, "production");
    const configured = await resolveConfig(
      {
        experimental: {
          serverComponents: true,
          optimizedBoundary: true,
        },
      },
      "production",
    );

    expect(defaults.experimental.optimizedBoundary).toBeUndefined();
    expect(configured.experimental).toMatchObject({
      serverComponents: true,
      optimizedBoundary: true,
    });
  });

  it("enables DevTools by default only in development", async () => {
    const development = await resolveConfig({}, "development");
    const production = await resolveConfig({}, "production");

    expect(development.devtools).toEqual({
      enabled: true,
      shortcut: "mod+shift+.",
    });
    expect(production.devtools).toEqual({
      enabled: false,
      shortcut: false,
    });
  });

  it("resolves disabled and custom DevTools controls", async () => {
    const disabled = await resolveConfig({ devtools: { enabled: false } }, "development");
    const customized = await resolveConfig(
      { devtools: { shortcut: "Mod + Shift + D" } },
      "development",
    );

    expect(disabled.devtools).toEqual({ enabled: false, shortcut: false });
    expect(customized.devtools).toEqual({ enabled: true, shortcut: "mod+shift+d" });
  });

  it("resolves explicit and generated deployment IDs", async () => {
    delete process.env.FARM_DEPLOYMENT_ID;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.CF_PAGES_COMMIT_SHA;
    const explicit = await resolveConfig({ deploymentId: "release-explicit" }, "production");
    let generationCalls = 0;
    const generated = await resolveConfig(
      {
        generateBuildId() {
          generationCalls += 1;
          return "release-generated";
        },
      },
      "production",
    );

    expect(explicit.deploymentId).toBe("release-explicit");
    expect(generated.deploymentId).toBe("release-generated");
    expect(generationCalls).toBe(1);
  });

  it("uses a stable development deployment ID without invoking the build generator", async () => {
    let generationCalls = 0;
    const config = await resolveConfig(
      {
        generateBuildId() {
          generationCalls += 1;
          return "should-not-run";
        },
      },
      "development",
    );

    expect(config.deploymentId).toBe("development");
    expect(generationCalls).toBe(0);
  });

  it("resolves secure server action defaults and overrides", async () => {
    const defaults = await resolveConfig({}, "production");
    expect(defaults.server).toEqual({
      bodySizeLimit: 10_000_000,
      trustProxy: false,
      headersTimeout: 60_000,
      requestTimeout: 300_000,
      keepAliveTimeout: 5_000,
      gracefulShutdownTimeout: 30_000,
      health: {
        enabled: true,
        livenessPath: "/_farm/health/live",
        readinessPath: "/_farm/health/ready",
      },
    });
    expect(defaults.serverActions).toEqual({
      allowedOrigins: [],
      bodySizeLimit: 1_000_000,
    });

    const configured = await resolveConfig(
      {
        serverActions: {
          allowedOrigins: ["HTTPS://APP.EXAMPLE.COM/", "*.proxy.example.com"],
          bodySizeLimit: "2mb",
        },
      },
      "production",
    );

    expect(configured.serverActions).toEqual({
      allowedOrigins: ["https://app.example.com", "*.proxy.example.com"],
      bodySizeLimit: 2_000_000,
    });

    const server = await resolveConfig(
      {
        server: {
          bodySizeLimit: "25mb",
          trustProxy: true,
          headersTimeout: "10s",
          requestTimeout: "1m",
          gracefulShutdownTimeout: "20s",
        },
      },
      "production",
    );
    expect(server.server).toEqual({
      bodySizeLimit: 25_000_000,
      trustProxy: true,
      headersTimeout: 10_000,
      requestTimeout: 60_000,
      keepAliveTimeout: 5_000,
      gracefulShutdownTimeout: 20_000,
      health: {
        enabled: true,
        livenessPath: "/_farm/health/live",
        readinessPath: "/_farm/health/ready",
      },
    });
  });

  it("resolves image pipeline config", async () => {
    const config = await resolveConfig(
      {
        images: {
          provider: "node",
          path: "/media/image",
          qualities: [60, 80],
          remotePatterns: [
            {
              protocol: "https",
              hostname: "images.example.com",
              pathname: "/catalog/**",
            },
          ],
        },
      },
      "production",
    );

    expect(config.images).toMatchObject({
      provider: "node",
      path: "/media/image",
      qualities: [60, 80],
      remotePatterns: [
        {
          protocol: "https",
          hostname: "images.example.com",
          pathname: "/catalog/**",
        },
      ],
    });
  });

  it("resolves MDX app page config", async () => {
    const config = await resolveConfig(
      {
        mdx: {
          components: "./src/markdown-components.tsx",
          markdownRoutes: false,
          className: "prose",
        },
      },
      "development",
    );

    expect(config.mdx).toMatchObject({
      components: "./src/markdown-components.tsx",
      markdownRoutes: false,
      className: "prose",
    });
  });

  it("preserves observability config and event callbacks", async () => {
    const onEvent = () => {};
    const config = await resolveConfig(
      {
        observability: {
          logs: true,
          onEvent,
          events: ["cache.hit", "ppr.shell.cached"],
        },
      },
      "development",
    );

    expect(config.observability).toMatchObject({
      logs: true,
      onEvent,
      events: ["cache.hit", "ppr.shell.cached"],
    });
  });

  it("resolves workflow config defaults and overrides", async () => {
    const config = await resolveConfig(
      {
        workflows: {
          dir: "src/background",
          route: "/api/internal/workflows",
          secretEnv: "WORKFLOW_SECRET",
        },
      },
      "production",
    );

    expect(config.workflows).toEqual({
      enabled: true,
      dirs: ["src/background"],
      route: "/api/internal/workflows",
      secretEnv: "WORKFLOW_SECRET",
      secret: undefined,
    });
  });

  it("validates typed env from process env", async () => {
    process.env.DATABASE_URL = "postgres://from-process/farm";
    process.env.PUBLIC_APP_URL = "https://process.example";

    const config = await resolveConfig(
      {
        env: {
          server: {
            DATABASE_URL: {
              parse(value: unknown) {
                if (typeof value !== "string") {
                  throw new Error("required");
                }

                return value;
              },
            },
          },
          public: {
            PUBLIC_APP_URL: {
              parse(value: unknown) {
                return String(value);
              },
            },
          },
        },
      },
      "development",
    );

    expect(config.env).toEqual({
      server: { DATABASE_URL: "postgres://from-process/farm" },
      public: { PUBLIC_APP_URL: "https://process.example" },
    });
    expect(getResolvedEnv()).toEqual(config.env);
  });

  it("resolves API URL functions after typed env", async () => {
    process.env.PUBLIC_API_ORIGIN = "https://api.example.com";

    const config = await resolveConfig(
      {
        env: {
          public: {
            PUBLIC_API_ORIGIN: (value) => String(value),
          },
        },
        api: {
          baseURL: ({ env }) => env.public.PUBLIC_API_ORIGIN as string,
          basePath: async ({ mode }) => (mode === "production" ? "/v2" : "/api"),
        },
      },
      "production",
    );

    expect(config.api).toEqual({
      baseURL: "https://api.example.com/v2",
      basePath: "/v2",
    });
  });

  it("throws when typed env validation fails", async () => {
    await expect(
      resolveConfig(
        {
          env: {
            server: {
              DATABASE_URL: {
                parse(value: unknown) {
                  if (!value) {
                    throw new Error("missing database url");
                  }

                  return String(value);
                },
              },
            },
          },
        },
        "production",
      ),
    ).rejects.toThrow('Invalid server env "DATABASE_URL": missing database url');
  });

  it("normalizes routeRules and derives redirects and headers", async () => {
    const config = await resolveConfig(
      {
        routeRules: {
          "/": { prerender: true },
          "blog/**": { swr: 3600 },
          "/admin/**": { render: "dynamic" },
          "/reports/**": {
            runtime: "edge",
            regions: ["iad1", "fra1"],
            maxDuration: 30,
          },
          "/api/**": {
            cors: { origin: "https://app.example", methods: ["GET", "POST"] },
          },
          "/old": { redirect: { to: "/new", permanent: true } },
          "/assets/**": { headers: { "Cache-Control": "public, max-age=31536000" } },
        },
      },
      "production",
    );

    expect(config.routeRules).toMatchObject({
      "/": { prerender: true },
      "/blog/**": { swr: 3600 },
      "/admin/**": { render: "dynamic" },
      "/reports/**": {
        runtime: "edge",
        regions: ["iad1", "fra1"],
        maxDuration: 30,
      },
      "/api/**": {
        cors: { origin: "https://app.example", methods: ["GET", "POST"] },
      },
    });

    expect(config.redirects()).toEqual([
      {
        source: "/old",
        destination: "/new",
        permanent: true,
        statusCode: 308,
      },
    ]);
    expect(config.headers()).toEqual(
      expect.arrayContaining([
        {
          source: "/api/**",
          headers: expect.arrayContaining([
            { key: "Access-Control-Allow-Origin", value: "https://app.example" },
            { key: "Access-Control-Allow-Methods", value: "GET, POST" },
            { key: "Access-Control-Allow-Headers", value: "*" },
          ]),
        },
        {
          source: "/assets/**",
          headers: [{ key: "Cache-Control", value: "public, max-age=31536000" }],
        },
      ]),
    );

    expect(routeRulesToNitroRouteRules(config.routeRules)).toMatchObject({
      "/": { prerender: true },
      "/blog/**": { swr: 3600 },
      "/admin/**": { prerender: false },
      "/reports/**": {},
      "/old": { redirect: "/new" },
      "/api/**": {
        cors: true,
        headers: {
          "Access-Control-Allow-Origin": "https://app.example",
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "*",
        },
      },
    });
  });

  it("applies security.csp after ordinary and route-rule headers", async () => {
    const config = await resolveConfig(
      {
        root: process.cwd(),
        headers: [{ source: "/*", headers: [{ key: "X-App", value: "farm" }] }],
        security: {
          csp: {
            directives: {
              defaultSrc: ["'self'"],
              objectSrc: ["'none'"],
            },
          },
        },
      },
      "production",
    );

    expect(config.security.csp).toEqual({
      value: "default-src 'self'; object-src 'none'",
      reportOnly: false,
    });
    expect((await config.headers()).at(-1)).toEqual({
      source: "/*",
      headers: [
        {
          key: "Content-Security-Policy",
          value: "default-src 'self'; object-src 'none'",
        },
      ],
    });
  });
});

describe("resolveMigrationsConfig", () => {
  it("normalizes shorthand and object migration command config", () => {
    expect(resolveMigrationsConfig(["pnpm prisma migrate deploy"])).toEqual({
      commands: ["pnpm prisma migrate deploy"],
    });

    expect(
      resolveMigrationsConfig({
        commands: [
          {
            name: "drizzle",
            command: "pnpm drizzle-kit migrate",
          },
        ],
      }),
    ).toEqual({
      commands: [
        {
          name: "drizzle",
          command: "pnpm drizzle-kit migrate",
        },
      ],
    });
  });
});

describe("detectPlatformDeployTarget", () => {
  it("maps platform build env vars to deploy targets", () => {
    expect(detectPlatformDeployTarget({ VERCEL: "1" })).toBe("vercel");
    expect(detectPlatformDeployTarget({ NETLIFY: "true" })).toBe("netlify");
    expect(detectPlatformDeployTarget({ CF_PAGES: "1" })).toBe("cloudflare");
    expect(detectPlatformDeployTarget({})).toBeUndefined();
    expect(detectPlatformDeployTarget({ VERCEL: "" })).toBeUndefined();
  });
});

describe("resolveDeployConfig platform detection", () => {
  it("uses the detected platform when nothing selects a preset", () => {
    const deploy = resolveDeployConfig({}, { env: { VERCEL: "1" } });
    expect(deploy.target).toBe("vercel");
    expect(deploy.preset).toBe("vercel");
    expect(deploy.outputDir).toBe(".vercel/output");
  });

  it("never overrides an explicit target, even when it cannot deploy there", () => {
    const deploy = resolveDeployConfig({ deploy: { target: "node" } }, { env: { VERCEL: "1" } });
    expect(deploy.target).toBe("node");
    expect(deploy.preset).toBe("node-server");
  });

  it("never overrides an explicit preset", () => {
    const deploy = resolveDeployConfig({ preset: "node-server" }, { env: { NETLIFY: "true" } });
    expect(deploy.target).toBe("node");
    expect(deploy.preset).toBe("node-server");
  });

  it("respects CLI overrides above detection", () => {
    const deploy = resolveDeployConfig({}, { target: "cloudflare", env: { VERCEL: "1" } });
    expect(deploy.target).toBe("cloudflare");
  });

  it("keeps the node-server default outside platform CI", () => {
    const deploy = resolveDeployConfig({}, { env: {} });
    expect(deploy.target).toBe("node");
    expect(deploy.preset).toBe("node-server");
  });
});

describe("resolveDeployConfig", () => {
  it("infers vercel preset and Build Output API directory from deploy target", async () => {
    const config = await resolveConfig(
      {
        deploy: {
          target: "vercel",
        },
      },
      "production",
    );

    expect(config.preset).toBe("vercel");
    expect(config.deploy).toMatchObject({
      target: "vercel",
      preset: "vercel",
      outputDir: ".vercel/output",
    });
  });

  it("lets CLI preset overrides recompute the deploy output directory", () => {
    const deploy = resolveDeployConfig({}, { preset: "vercel" });

    expect(deploy).toMatchObject({
      target: "vercel",
      preset: "vercel",
      outputDir: ".vercel/output",
    });
  });

  it("lets a preset override displace the configured platform target", () => {
    // The bug this pins: with deploy.target vercel in config,
    // `farm build --preset node-server` produced a node server inside
    // .vercel/output — a directory Vercel deploys as Build Output API
    // content. The explicit preset must replace the deployment plan.
    const deploy = resolveDeployConfig({ deploy: { target: "vercel" } }, { preset: "node-server" });

    expect(deploy).toMatchObject({
      target: "node",
      preset: "node-server",
      outputDir: ".farm/.output",
    });
  });

  it("keeps a preset override with no matching target out of platform directories", () => {
    const deploy = resolveDeployConfig({ deploy: { target: "vercel" } }, { preset: "deno-server" });

    expect(deploy.preset).toBe("deno-server");
    expect(deploy.outputDir).toBe(".farm/.output");
  });

  it("respects an explicitly configured output directory under a preset override", () => {
    const deploy = resolveDeployConfig(
      { deploy: { target: "vercel", outputDir: "custom-out" } },
      { preset: "node-server" },
    );

    expect(deploy.outputDir).toBe("custom-out");
  });

  it("recognizes the Cloudflare module preset used by agent Workers", () => {
    const deploy = resolveDeployConfig({ preset: "cloudflare-module" });

    expect(deploy).toMatchObject({
      target: "cloudflare",
      preset: "cloudflare-module",
    });
  });

  it("respects explicit deploy output aliases", () => {
    const deploy = resolveDeployConfig({
      deploy: {
        target: "netlify",
        output: "custom-output",
      },
    });

    expect(deploy).toMatchObject({
      target: "netlify",
      preset: "netlify",
      outputDir: "custom-output",
    });
  });
});

describe("resolveDocsConfig", () => {
  it("preserves an external adapter descriptor outside public docs config", async () => {
    const adapter = {
      id: "@farming-labs/farmjs",
      protocol: 1,
      server: "@farming-labs/farmjs/server",
      react: "@farming-labs/farmjs/react",
      vite: "@farming-labs/farmjs/vite",
    };
    const docs = await resolveDocsConfig({ entry: "/docs", adapter });

    expect(docs.adapter).toEqual(adapter);
    expect(docs.config).not.toHaveProperty("adapter");
  });

  it("normalizes a Farm docs entry route into docs config shape", async () => {
    const docs = await resolveDocsConfig({
      entry: "/docs",
      config: {
        metadata: {
          description: "Example docs",
        },
      },
    });

    expect(docs).toMatchObject({
      enabled: true,
      entry: "/docs",
      config: {
        entry: "docs",
        docsPath: "/docs",
        metadata: {
          description: "Example docs",
        },
      },
    });
  });

  it("infers docs content from Farm's srcDir and lets an explicit directory win", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-src-dir-"));
    await fs.mkdir(path.join(root, "source", "app", "guides"), { recursive: true });

    const inferred = await resolveDocsConfig({ entry: "/guides" }, { root, srcDir: "source" });
    const explicit = await resolveDocsConfig(
      { entry: "/guides", contentDir: "content/manual" },
      { root, srcDir: "source" },
    );

    expect(inferred).toMatchObject({
      contentDir: "source/app/guides",
      config: { contentDir: "source/app/guides" },
    });
    expect(explicit).toMatchObject({
      contentDir: "content/manual",
      config: { contentDir: "content/manual" },
    });
  });

  it("auto-enables docs when docs.json exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-json-"));
    await fs.writeFile(
      path.join(root, "docs.json"),
      JSON.stringify({
        entry: "guides",
        metadata: {
          description: "Guide docs",
        },
      }),
    );

    const docs = await resolveDocsConfig(undefined, { root });

    expect(docs).toMatchObject({
      enabled: true,
      entry: "/guides",
      config: {
        entry: "guides",
        docsPath: "/guides",
        metadata: {
          description: "Guide docs",
        },
      },
    });
    expect(docs.configPath).toBe(path.join(root, "docs.json"));
  });

  it("lets docs false opt out even when a docs config file exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-disabled-"));
    await fs.writeFile(path.join(root, "docs.json"), JSON.stringify({ entry: "guides" }));

    const docs = await resolveDocsConfig(false, { root });

    expect(docs.enabled).toBe(false);
  });
});
