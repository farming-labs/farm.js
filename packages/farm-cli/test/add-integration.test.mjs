import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { addFarmIntegration, listFarmIntegrationProviders } = require("../dist/add-integration.js");
const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(testDir, "../bin/farm.js");

test("lists official integration providers", () => {
  const providers = listFarmIntegrationProviders().map((provider) => provider.name);

  assert.ok(providers.includes("stripe"));
  assert.ok(providers.includes("ai"));
  assert.ok(providers.includes("supabase"));
  assert.ok(providers.includes("unkey"));
  assert.ok(providers.includes("jobs-inngest"));
});

test("all official integration providers expose opt-in UI metadata", () => {
  for (const provider of listFarmIntegrationProviders()) {
    assert.ok(provider.ui, `${provider.name} should expose a --ui feature pack`);
    assert.ok(provider.ui.feature, `${provider.name} should name its UI feature pack`);
    assert.ok(provider.ui.components.length, `${provider.name} should declare shadcn components`);
  }
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
    assert.match(config, /import \{ defineConfig \} from "@farmjs\/core"/);
    assert.match(config, /export default defineConfig\(\{/);
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
      `import { defineConfig } from "@farmjs/core";

export default defineConfig({
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

test("adds an integration to a config using defineConfig", async () => {
  const root = await createTempProject({
    packageJson: {
      type: "module",
      dependencies: {
        "@farmjs/core": "workspace:*",
      },
    },
  });

  try {
    await writeFile(
      path.join(root, "farm.config.ts"),
      `import { defineConfig } from "@farmjs/core";

export default defineConfig({
  srcDir: "src",
});
`,
      "utf8",
    );

    await addFarmIntegration({
      root,
      provider: "stripe",
    });

    const config = await readFile(path.join(root, "farm.config.ts"), "utf8");

    assert.match(config, /defineConfig\(\{/);
    assert.match(config, /integrations: appIntegrations/);
    assert.match(config, /srcDir: "src"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adds a stripe integration with the shadcn UI feature pack", async () => {
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
      provider: "stripe",
      ui: true,
    });

    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const componentsJson = JSON.parse(await readFile(path.join(root, "components.json"), "utf8"));
    const tsconfig = JSON.parse(await readFile(path.join(root, "tsconfig.json"), "utf8"));
    const globals = await readFile(path.join(root, "src/app/globals.css"), "utf8");
    const api = await readFile(path.join(root, "src/lib/api.ts"), "utf8");
    const pricing = await readFile(
      path.join(root, "src/components/farm/stripe-billing.tsx"),
      "utf8",
    );
    const button = await readFile(path.join(root, "src/components/ui/button.tsx"), "utf8");
    const page = await readFile(path.join(root, "src/app/integrations/stripe/page.tsx"), "utf8");

    assert.deepEqual(result.ui, {
      feature: "stripe-billing",
      components: ["badge", "button", "card"],
      files: result.ui.files,
    });
    assert.equal(packageJson.dependencies["@farmjs/integrations"], "workspace:*");
    assert.equal(packageJson.dependencies["class-variance-authority"], "^0.7.1");
    assert.equal(packageJson.dependencies.clsx, "^2.1.1");
    assert.equal(packageJson.dependencies["tailwind-merge"], "^3.3.1");
    assert.equal(componentsJson.aliases.ui, "@/components/ui");
    assert.equal(componentsJson.registries.farm.url, "https://farmjs.dev/r/{name}.json");
    assert.deepEqual(tsconfig.compilerOptions.paths["@/*"], ["./src/*"]);
    assert.match(globals, /--color-background/);
    assert.match(api, /createIntegrations<AppIntegrations>/);
    assert.match(pricing, /apiClient\.billing\.products/);
    assert.match(pricing, /apiClient\.billing\.checkout/);
    assert.match(pricing, /from "@\/components\/ui\/button"/);
    assert.match(button, /class-variance-authority/);
    assert.match(button, /from "@\/lib\/utils"/);
    assert.match(page, /from "@\/components\/farm\/stripe-billing"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepares UI files for every built-in integration provider", async () => {
  for (const provider of listFarmIntegrationProviders()) {
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
        provider: provider.name,
        ui: true,
        dryRun: true,
      });

      assert.ok(result.ui, `${provider.name} should install a UI feature`);
      assert.equal(result.ui.feature, provider.ui.feature);
      assert.deepEqual(result.ui.components, provider.ui.components);
      assert.ok(
        result.created.some((file) => file.includes(path.join("src", "components", "farm"))),
        `${provider.name} should prepare a Farm UI component`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("runs farm add integration stripe --ui through the CLI", async () => {
  const root = await createTempProject({
    packageJson: {
      type: "module",
      dependencies: {
        "@farmjs/core": "workspace:*",
      },
    },
  });

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      cliBin,
      "add",
      "integration",
      "stripe",
      "--ui",
      "--root",
      root,
    ]);

    assert.match(stdout, /Added stripe integration as appIntegrations\.billing/);
    assert.match(stdout, /UI feature: stripe-billing/);
    assert.match(stdout, /Shadcn components: badge, button, card/);
    assert.match(
      await readFile(path.join(root, "src/components/farm/stripe-billing.tsx"), "utf8"),
      /apiClient\.billing\.checkout/,
    );
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
