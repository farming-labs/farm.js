// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadConfig,
  resolveConfig,
  resolveDeployConfig,
  resolveDocsConfig,
  resolveMigrationsConfig,
} from "../config";

const originalEnv = { ...process.env };

afterEach(() => {
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
