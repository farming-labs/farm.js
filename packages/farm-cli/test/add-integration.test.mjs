import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { addFarmIntegration, listFarmIntegrationProviders } = require("../dist/add-integration.js");

test("lists official integration providers", () => {
  const providers = listFarmIntegrationProviders().map((provider) => provider.name);

  assert.ok(providers.includes("stripe"));
  assert.ok(providers.includes("ai"));
  assert.ok(providers.includes("supabase"));
  assert.ok(providers.includes("jobs-inngest"));
});

test("adds a supabase integration to a new app", async () => {
  const root = await createTempProject({
    packageJson: {
      type: "module",
      dependencies: {
        "@farmjs/core": "workspace:*",
      },
    },
  });

  try {
    const result = await addFarmIntegration({
      root,
      provider: "supabase",
    });

    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const registry = await readFile(path.join(root, "src/lib/integrations.ts"), "utf8");
    const component = await readFile(path.join(root, "src/lib/integrations/supabase.ts"), "utf8");
    const config = await readFile(path.join(root, "farm.config.ts"), "utf8");

    assert.equal(result.provider, "supabase");
    assert.equal(result.key, "auth");
    assert.equal(packageJson.dependencies["@farmjs/integrations"], "workspace:*");
    assert.match(registry, /import \{ supabaseIntegration \}/);
    assert.match(registry, /auth: supabaseIntegration/);
    assert.match(component, /supabase\(\{/);
    assert.match(config, /integrations: appIntegrations/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adds a stripe integration to an existing registry and config", async () => {
  const root = await createTempProject({
    packageJson: {
      type: "module",
      dependencies: {
        "@farmjs/core": "^0.1.0",
      },
    },
  });

  try {
    await mkdir(path.join(root, "src/lib"), { recursive: true });
    await writeFile(
      path.join(root, "src/lib/integrations.ts"),
      `import { existingIntegration } from "./integrations/existing.ts";

export const appIntegrations = {
  existing: existingIntegration,
} as const;

export type AppIntegrations = typeof appIntegrations;
`,
      "utf8",
    );
    await writeFile(
      path.join(root, "farm.config.ts"),
      `import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  vite: {
    server: {
      port: 3000,
    },
  },
});
`,
      "utf8",
    );

    await addFarmIntegration({
      root,
      provider: "stripe",
      key: "payments",
    });

    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const registry = await readFile(path.join(root, "src/lib/integrations.ts"), "utf8");
    const component = await readFile(path.join(root, "src/lib/integrations/stripe.ts"), "utf8");
    const config = await readFile(path.join(root, "farm.config.ts"), "utf8");

    assert.equal(packageJson.dependencies["@farmjs/integrations"], "latest");
    assert.match(registry, /existing: existingIntegration/);
    assert.match(registry, /payments: stripeIntegration/);
    assert.match(component, /secretKey: process\.env\.STRIPE_SECRET_KEY/);
    assert.match(config, /import \{ appIntegrations \}/);
    assert.match(config, /integrations: appIntegrations/);
    assert.match(config, /vite:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adds a Vercel AI SDK chat route template", async () => {
  const root = await createTempProject({
    packageJson: {
      type: "module",
      dependencies: {
        "@farmjs/core": "workspace:*",
      },
    },
  });

  try {
    const result = await addFarmIntegration({
      root,
      provider: "vercel-ai-sdk",
    });

    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const routeFile = path.join(root, "src/app/api/chat/route.ts");
    const route = await readFile(routeFile, "utf8");

    assert.equal(result.provider, "ai");
    assert.equal(result.key, "chat");
    assert.equal(result.mode, "route");
    assert.equal(result.routeFile, routeFile);
    assert.equal(result.routePath, "/api/chat");
    assert.deepEqual(result.env, ["AI_GATEWAY_API_KEY"]);
    assert.equal(packageJson.dependencies["@farmjs/integrations"], "workspace:*");
    assert.match(route, /import \{ aiChatRoute \} from "@farmjs\/integrations\/ai"/);
    assert.match(route, /export const POST = aiChatRoute/);
    assert.match(route, /model: "openai\/gpt-4o-mini"/);
    await assert.rejects(() => readFile(path.join(root, "src/lib/integrations.ts"), "utf8"));
    await assert.rejects(() => readFile(path.join(root, "farm.config.ts"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects duplicate integration keys", async () => {
  const root = await createTempProject({
    packageJson: {
      type: "module",
      dependencies: {},
    },
  });

  try {
    await mkdir(path.join(root, "src/lib"), { recursive: true });
    await writeFile(
      path.join(root, "src/lib/integrations.ts"),
      `export const appIntegrations = {
  auth: existingIntegration,
} as const;
`,
      "utf8",
    );

    await assert.rejects(
      () =>
        addFarmIntegration({
          root,
          provider: "workos",
        }),
      /Integration key "auth" already exists/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createTempProject(input) {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-add-integration-"));
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(input.packageJson, null, 2)}\n`,
    "utf8",
  );
  return root;
}
