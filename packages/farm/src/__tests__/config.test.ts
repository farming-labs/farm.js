// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defineConfig,
  defineFarmConfig,
  loadConfig,
  resolveConfig,
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
});

describe("loadConfig", () => {
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
