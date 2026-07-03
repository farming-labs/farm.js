// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, resolveConfig, resolveDeployConfig } from "../config";

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
