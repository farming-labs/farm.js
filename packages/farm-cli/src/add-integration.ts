import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  aiChatUIFeature,
  auth0AuthUIFeature,
  authjsUIFeature,
  autumnBillingUIFeature,
  betterAuthUIFeature,
  clerkAuthUIFeature,
  installUIFeature,
  jobsUIFeature,
  polarBillingUIFeature,
  resendEmailUIFeature,
  stripeBillingUIFeature,
  supabaseAuthUIFeature,
  unkeyApiKeysUIFeature,
  workosAuthUIFeature,
  type AddFarmIntegrationUIResult,
  type UIFeatureDefinition,
} from "./ui-feature-registry";

export type { AddFarmIntegrationUIResult } from "./ui-feature-registry";

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export interface AddFarmIntegrationOptions {
  root?: string;
  provider: string;
  key?: string;
  integrationsFile?: string;
  routeFile?: string;
  ui?: boolean;
  skipPackageJson?: boolean;
  skipConfig?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

export interface AddFarmIntegrationResult {
  provider: FarmIntegrationProvider;
  key: string;
  mode?: "integration" | "route";
  integrationFile: string;
  registryFile: string;
  routeFile?: string;
  routePath?: string;
  packageJson?: string;
  configFile?: string;
  created: string[];
  updated: string[];
  skipped: string[];
  env: string[];
  notes: string[];
  ui?: AddFarmIntegrationUIResult;
}

export type FarmIntegrationProvider =
  | "ai"
  | "auth0"
  | "authjs"
  | "autumn"
  | "better-auth"
  | "clerk"
  | "jobs-inngest"
  | "jobs-trigger"
  | "polar"
  | "resend"
  | "stripe"
  | "supabase"
  | "unkey"
  | "workos";

interface IntegrationProviderDefinition {
  provider: FarmIntegrationProvider;
  aliases: readonly string[];
  defaultKey: string;
  fileName: string;
  exportName: string;
  description: string;
  env: readonly string[];
  notes?: readonly string[];
  ui?: UIFeatureDefinition;
  template(): string;
}

const PROVIDERS: readonly IntegrationProviderDefinition[] = [
  {
    provider: "ai",
    aliases: ["ai-sdk", "vercel-ai", "vercel-ai-sdk", "chat"],
    defaultKey: "chat",
    fileName: "chat",
    exportName: "POST",
    description: "Vercel AI SDK chat route",
    env: ["AI_GATEWAY_API_KEY"],
    notes: [
      'Use @ai-sdk/react useChat with api: "/api/chat" on the client.',
      "Replace model with any AI SDK provider model or Vercel AI Gateway model id.",
      "No farm.config integration wiring is required for this route.",
    ],
    ui: aiChatUIFeature(),
    template: () => `import { aiChatRoute } from "@farmjs/integrations/ai";

export const POST = aiChatRoute({
  model: "openai/gpt-4o-mini",
  system: "You are a helpful assistant.",
});
`,
  },
  {
    provider: "stripe",
    aliases: ["billing-stripe", "payments", "stripe-billing"],
    defaultKey: "billing",
    fileName: "stripe",
    exportName: "stripeIntegration",
    description: "Stripe billing and checkout routes",
    env: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    template: () => `import { stripe } from "@farmjs/integrations/stripe";

export const stripeIntegration = stripe({
  secretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  products: [],
  log(event) {
    console.log("[stripe]", event.phase, event.route?.path || "none");
  },
});
`,
    ui: stripeBillingUIFeature(),
  },
  {
    provider: "supabase",
    aliases: ["auth-supabase", "supabase-auth"],
    defaultKey: "auth",
    fileName: "supabase",
    exportName: "supabaseIntegration",
    description: "Supabase auth routes and middleware",
    env: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "APP_BASE_URL"],
    ui: supabaseAuthUIFeature(),
    template: () => `import { supabase } from "@farmjs/integrations/supabase";

export const supabaseIntegration = supabase({
  callbackUrl: \`\${process.env.APP_BASE_URL || "http://localhost:3000"}/auth/callback\`,
  protectedRoutes: ["/dashboard(.*)"],
  pages: {
    signIn: "/sign-in",
    signUp: "/sign-up",
  },
  log(event) {
    console.log("[supabase]", event.phase, event.route?.path || "none");
  },
});
`,
  },
  {
    provider: "workos",
    aliases: ["auth-workos", "workos-auth"],
    defaultKey: "auth",
    fileName: "workos",
    exportName: "workosIntegration",
    description: "WorkOS auth routes and protected route middleware",
    env: ["WORKOS_CLIENT_ID", "WORKOS_API_KEY", "WORKOS_COOKIE_PASSWORD"],
    ui: workosAuthUIFeature(),
    template: () => `import { workos } from "@farmjs/integrations/workos";

export const workosIntegration = workos({
  protectedRoutes: ["/dashboard(.*)"],
  log(event) {
    console.log("[workos]", event.phase, event.route?.path || "none");
  },
});
`,
  },
  {
    provider: "auth0",
    aliases: ["auth-auth0", "auth0-auth"],
    defaultKey: "auth",
    fileName: "auth0",
    exportName: "auth0Integration",
    description: "Auth0 login, callback, logout, and profile routes",
    env: ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET"],
    ui: auth0AuthUIFeature(),
    template: () => `import { auth0 } from "@farmjs/integrations/auth0";

export const auth0Integration = auth0({
  callbackUrl: \`\${process.env.APP_BASE_URL || "http://localhost:3000"}/auth/callback\`,
  protectedRoutes: ["/dashboard(.*)"],
  log(event) {
    console.log("[auth0]", event.phase, event.route?.path || "none");
  },
});
`,
  },
  {
    provider: "clerk",
    aliases: ["auth-clerk", "clerk-auth"],
    defaultKey: "auth",
    fileName: "clerk",
    exportName: "clerkIntegration",
    description: "Clerk auth provider and protected route middleware",
    env: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"],
    ui: clerkAuthUIFeature(),
    template: () => `import { clerk } from "@farmjs/integrations/clerk";

export const clerkIntegration = clerk({
  signInUrl: "/sign-in",
  signUpUrl: "/sign-up",
  protectedRoutes: ["/dashboard(.*)"],
  log(event) {
    console.log("[clerk]", event.phase, event.route?.path || "none");
  },
});
`,
  },
  {
    provider: "resend",
    aliases: ["email", "resend-email"],
    defaultKey: "email",
    fileName: "resend",
    exportName: "resendIntegration",
    description: "Resend email send, preview, schedule, and webhook routes",
    env: ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET"],
    ui: resendEmailUIFeature(),
    template: () => `import { createElement } from "react";
import { resend, template } from "@farmjs/integrations/email";

function WelcomeEmail(props: { name: string }) {
  return createElement("div", null, \`Welcome \${props.name}\`);
}

WelcomeEmail.PreviewProps = {
  name: "Ada",
};

export const emailTemplates = {
  welcome: template(WelcomeEmail, {
    subject: ({ name }) => \`Welcome, \${name}\`,
    previewText: () => "Welcome to the app",
  }),
} as const;

export const resendIntegration = resend({
  apiKey: process.env.RESEND_API_KEY,
  defaults: {
    from: process.env.RESEND_FROM_EMAIL,
    replyTo: process.env.RESEND_REPLY_TO_EMAIL ?? process.env.RESEND_FROM_EMAIL,
  },
  templates: emailTemplates,
  webhooks: process.env.RESEND_WEBHOOK_SECRET
    ? {
        secret: process.env.RESEND_WEBHOOK_SECRET,
      }
    : undefined,
  log(event) {
    console.log("[resend]", event.phase, event.route?.path || "none");
  },
});
`,
  },
  {
    provider: "jobs-inngest",
    aliases: ["inngest", "jobs"],
    defaultKey: "jobs",
    fileName: "jobs-inngest",
    exportName: "jobsIntegration",
    description: "Jobs integration backed by Inngest",
    env: ["INNGEST_APP_ID", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"],
    notes: ["Add tasks to jobTasks before using the generated jobs API."],
    ui: jobsUIFeature("inngest"),
    template: () => `import { defineTasks, inngest, jobs } from "@farmjs/integrations/jobs";

export const jobTasks = defineTasks({});

export const jobsIntegration = jobs({
  runtime: inngest({
    appId: process.env.INNGEST_APP_ID,
    eventKey: process.env.INNGEST_EVENT_KEY,
    signingKey: process.env.INNGEST_SIGNING_KEY,
  }),
  tasks: jobTasks,
  log(event) {
    console.log("[jobs:inngest]", event.phase, event.route?.path || "none");
  },
});
`,
  },
  {
    provider: "jobs-trigger",
    aliases: ["trigger", "trigger-dev", "jobs-triggerdev"],
    defaultKey: "jobs",
    fileName: "jobs-trigger",
    exportName: "jobsIntegration",
    description: "Jobs integration backed by Trigger.dev",
    env: ["TRIGGER_PROJECT_REF", "TRIGGER_SECRET_KEY", "TRIGGER_WEBHOOK_SECRET"],
    notes: ["Add tasks to jobTasks before using the generated jobs API."],
    ui: jobsUIFeature("trigger"),
    template: () => `import { defineTasks, jobs, trigger } from "@farmjs/integrations/jobs";

export const jobTasks = defineTasks({});

export const jobsIntegration = jobs({
  runtime: trigger({
    projectRef: process.env.TRIGGER_PROJECT_REF,
    apiKey: process.env.TRIGGER_SECRET_KEY,
    webhookSecret: process.env.TRIGGER_WEBHOOK_SECRET,
  }),
  tasks: jobTasks,
  log(event) {
    console.log("[jobs:trigger]", event.phase, event.route?.path || "none");
  },
});
`,
  },
  {
    provider: "polar",
    aliases: ["polar-billing", "billing-polar"],
    defaultKey: "billing",
    fileName: "polar",
    exportName: "polarIntegration",
    description: "Polar billing and checkout routes",
    env: ["POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", "APP_BASE_URL"],
    notes: ["Replace resolveBillingOwner with your app user or organization lookup."],
    ui: polarBillingUIFeature(),
    template: () => `import type { FarmIntegrationHandlerContext } from "@farmjs/core";
import { polar } from "@farmjs/integrations/polar";

async function resolveBillingOwner(_context: FarmIntegrationHandlerContext) {
  throw new Error("Configure Polar billing owner resolution for your app.");
}

export const polarIntegration = polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  server: (process.env.POLAR_SERVER as "sandbox" | "production" | undefined) ?? "sandbox",
  appBaseUrl: process.env.APP_BASE_URL,
  webhooks: process.env.POLAR_WEBHOOK_SECRET
    ? {
        secret: process.env.POLAR_WEBHOOK_SECRET,
      }
    : undefined,
  billing: {
    resolveOwner: resolveBillingOwner,
    plans: {},
    products: {},
  },
  log(event) {
    console.log("[polar]", event.phase, event.route?.path || "none");
  },
});
`,
  },
  {
    provider: "autumn",
    aliases: ["autumn-billing", "billing-autumn"],
    defaultKey: "billing",
    fileName: "autumn",
    exportName: "autumnIntegration",
    description: "Autumn billing and checkout routes",
    env: ["AUTUMN_SECRET_KEY", "AUTUMN_WEBHOOK_SECRET", "APP_BASE_URL"],
    notes: ["Replace resolveBillingOwner with your app user or organization lookup."],
    ui: autumnBillingUIFeature(),
    template: () => `import type { FarmIntegrationHandlerContext } from "@farmjs/core";
import { autumn } from "@farmjs/integrations/autumn";

async function resolveBillingOwner(_context: FarmIntegrationHandlerContext) {
  throw new Error("Configure Autumn billing owner resolution for your app.");
}

export const autumnIntegration = autumn({
  secretKey: process.env.AUTUMN_SECRET_KEY,
  appBaseUrl: process.env.APP_BASE_URL,
  webhooks: process.env.AUTUMN_WEBHOOK_SECRET
    ? {
        secret: process.env.AUTUMN_WEBHOOK_SECRET,
      }
    : undefined,
  billing: {
    resolveOwner: resolveBillingOwner,
    plans: {},
    products: {},
  },
  log(event) {
    console.log("[autumn]", event.phase, event.route?.path || "none");
  },
});
`,
  },
  {
    provider: "better-auth",
    aliases: ["betterauth", "auth-better-auth"],
    defaultKey: "auth",
    fileName: "better-auth",
    exportName: "betterAuthIntegration",
    description: "Better Auth route adapter",
    env: [],
    notes: ["This template expects src/lib/auth.ts to export a Better Auth instance named auth."],
    ui: betterAuthUIFeature(),
    template: () => `import { betterAuth } from "@farmjs/integrations/better-auth";
import { auth } from "../auth.ts";

export const betterAuthIntegration = betterAuth({
  instance: auth,
  log(event) {
    console.log("[better-auth]", event.phase, event.route?.path || "none");
  },
});
`,
  },
  {
    provider: "authjs",
    aliases: ["auth-js", "nextauth", "next-auth"],
    defaultKey: "auth",
    fileName: "authjs",
    exportName: "authjsIntegration",
    description: "Auth.js route adapter",
    env: [],
    notes: ["This template expects src/lib/auth.ts to export an Auth.js instance named auth."],
    ui: authjsUIFeature(),
    template: () => `import { authjs } from "@farmjs/integrations/authjs";
import { auth } from "../auth.ts";

export const authjsIntegration = authjs({
  instance: auth,
  log(event) {
    console.log("[authjs]", event.phase, event.route?.path || "none");
  },
});
`,
  },
  {
    provider: "unkey",
    aliases: ["api-keys", "apikeys", "keys", "unkey-api-keys"],
    defaultKey: "apiKeys",
    fileName: "unkey",
    exportName: "unkeyIntegration",
    description: "Unkey API key creation, verification, and route protection",
    env: ["UNKEY_ROOT_KEY", "UNKEY_API_ID", "UNKEY_BASE_URL"],
    ui: unkeyApiKeysUIFeature(),
    template: () => `import { unkey } from "@farmjs/integrations/unkey";

export const unkeyIntegration = unkey({
  rootKey: process.env.UNKEY_ROOT_KEY,
  apiId: process.env.UNKEY_API_ID,
  baseUrl: process.env.UNKEY_BASE_URL,
  protectedRoutes: ["/api/protected(.*)"],
  log(event) {
    console.log("[unkey]", event.phase, event.route?.path || "none");
  },
});
`,
  },
] as const;

export function listFarmIntegrationProviders() {
  return PROVIDERS.map((provider) => ({
    name: provider.provider,
    aliases: [...provider.aliases],
    defaultKey: provider.defaultKey,
    description: provider.description,
    env: [...provider.env],
    ui: provider.ui
      ? {
          feature: provider.ui.name,
          description: provider.ui.description,
          components: [...provider.ui.components],
        }
      : undefined,
  }));
}

export async function addFarmIntegration(
  options: AddFarmIntegrationOptions,
): Promise<AddFarmIntegrationResult> {
  const root = path.resolve(options.root || process.cwd());
  const definition = resolveProvider(options.provider);

  if (definition.provider === "ai") {
    return addAIRouteIntegration({
      root,
      definition,
      routeFile: options.routeFile,
      ui: options.ui,
      skipPackageJson: options.skipPackageJson,
      dryRun: options.dryRun,
      force: options.force,
    });
  }

  const key = options.key || definition.defaultKey;
  assertValidIntegrationKey(key);

  const registryFile = path.resolve(
    root,
    options.integrationsFile || path.join("src", "lib", "integrations.ts"),
  );
  const integrationFile = path.join(
    path.dirname(registryFile),
    "integrations",
    `${definition.fileName}.ts`,
  );
  const result: AddFarmIntegrationResult = {
    provider: definition.provider,
    key,
    mode: "integration",
    integrationFile,
    registryFile,
    created: [],
    updated: [],
    skipped: [],
    env: [...definition.env],
    notes: [...(definition.notes || [])],
  };

  await writeIntegrationComponent({
    path: integrationFile,
    definition,
    force: options.force,
    dryRun: options.dryRun,
    result,
  });
  await writeIntegrationRegistry({
    path: registryFile,
    integrationFile,
    definition,
    key,
    dryRun: options.dryRun,
    result,
  });

  if (!options.skipPackageJson) {
    await updatePackageJson({
      root,
      dryRun: options.dryRun,
      result,
    });
  }

  if (!options.skipConfig) {
    await updateFarmConfig({
      root,
      registryFile,
      dryRun: options.dryRun,
      result,
    });
  }

  if (options.ui) {
    await installUIFeature({
      root,
      definition,
      key,
      dryRun: options.dryRun,
      force: options.force,
      skipPackageJson: options.skipPackageJson,
      result,
    });
  }

  return result;
}

async function addAIRouteIntegration(input: {
  root: string;
  definition: IntegrationProviderDefinition;
  routeFile?: string;
  ui?: boolean;
  skipPackageJson?: boolean;
  dryRun?: boolean;
  force?: boolean;
}): Promise<AddFarmIntegrationResult> {
  const routeFile = path.resolve(
    input.root,
    input.routeFile || path.join("src", "app", "api", "chat", "route.ts"),
  );
  const result: AddFarmIntegrationResult = {
    provider: "ai",
    key: input.definition.defaultKey,
    mode: "route",
    integrationFile: routeFile,
    registryFile: "",
    routeFile,
    routePath: "/api/chat",
    created: [],
    updated: [],
    skipped: [],
    env: [...input.definition.env],
    notes: [...(input.definition.notes || [])],
  };

  await writeIntegrationComponent({
    path: routeFile,
    definition: input.definition,
    force: input.force,
    dryRun: input.dryRun,
    result,
  });

  if (!input.skipPackageJson) {
    await updatePackageJson({
      root: input.root,
      dryRun: input.dryRun,
      result,
    });
  }

  if (input.ui) {
    await installUIFeature({
      root: input.root,
      definition: input.definition,
      key: input.definition.defaultKey,
      dryRun: input.dryRun,
      force: input.force,
      skipPackageJson: input.skipPackageJson,
      result,
    });
  }

  return result;
}

function resolveProvider(input: string) {
  const normalized = input.trim().toLowerCase();
  const match = PROVIDERS.find(
    (provider) => provider.provider === normalized || provider.aliases.includes(normalized),
  );

  if (!match) {
    const supported = PROVIDERS.map((provider) => provider.provider).join(", ");
    throw new Error(`Unknown integration "${input}". Supported integrations: ${supported}.`);
  }

  return match;
}

function assertValidIntegrationKey(key: string) {
  if (!/^[A-Za-z_$][\w$]*$/.test(key)) {
    throw new Error(`Integration key "${key}" must be a valid JavaScript object property name.`);
  }
}

async function writeIntegrationComponent(input: {
  path: string;
  definition: IntegrationProviderDefinition;
  force?: boolean;
  dryRun?: boolean;
  result: AddFarmIntegrationResult;
}) {
  const exists = existsSync(input.path);
  if (exists && !input.force) {
    input.result.skipped.push(input.path);
    return;
  }

  if (!input.dryRun) {
    await mkdir(path.dirname(input.path), { recursive: true });
    await writeFile(input.path, input.definition.template(), "utf8");
  }

  if (exists) {
    input.result.updated.push(input.path);
  } else {
    input.result.created.push(input.path);
  }
}

async function writeIntegrationRegistry(input: {
  path: string;
  integrationFile: string;
  definition: IntegrationProviderDefinition;
  key: string;
  dryRun?: boolean;
  result: AddFarmIntegrationResult;
}) {
  const importPath = toImportPath(path.relative(path.dirname(input.path), input.integrationFile));
  const importLine = `import { ${input.definition.exportName} } from "${importPath}";`;
  const propertyLine = `  ${input.key}: ${input.definition.exportName},`;

  let nextSource: string;
  const exists = existsSync(input.path);

  if (exists) {
    const source = await readFile(input.path, "utf8");
    nextSource = ensureRegistryEntry(source, {
      importLine,
      propertyLine,
      key: input.key,
      exportName: input.definition.exportName,
    });
  } else {
    nextSource = `${importLine}

export const appIntegrations = {
${propertyLine}
} as const;

export type AppIntegrations = typeof appIntegrations;
`;
  }

  if (!input.dryRun) {
    await mkdir(path.dirname(input.path), { recursive: true });
    await writeFile(input.path, nextSource, "utf8");
  }

  input.result[exists ? "updated" : "created"].push(input.path);
}

function ensureRegistryEntry(
  source: string,
  input: {
    importLine: string;
    propertyLine: string;
    key: string;
    exportName: string;
  },
) {
  const keyPattern = new RegExp(`(^|\\n)\\s*${escapeRegExp(input.key)}\\s*:`, "m");
  if (keyPattern.test(source)) {
    if (source.includes(`${input.key}: ${input.exportName}`)) {
      return source.includes(input.importLine) ? source : `${input.importLine}\n${source}`;
    }

    throw new Error(
      `Integration key "${input.key}" already exists in the app integrations registry. Pass --key to use a different key.`,
    );
  }

  const sourceWithImport = source.includes(input.importLine)
    ? source
    : `${input.importLine}\n${source}`;
  const appIntegrationsPattern =
    /export\s+const\s+appIntegrations\s*=\s*\{([\s\S]*?)\}\s*as\s+const;/m;
  const match = sourceWithImport.match(appIntegrationsPattern);

  if (!match) {
    return `${sourceWithImport.trimEnd()}

export const appIntegrations = {
${input.propertyLine}
} as const;

export type AppIntegrations = typeof appIntegrations;
`;
  }

  const body = match[1] || "";
  const nextBody = body.trim().length
    ? `${body.trimEnd()}\n${input.propertyLine}\n`
    : `\n${input.propertyLine}\n`;

  return sourceWithImport.replace(appIntegrationsPattern, () => {
    return `export const appIntegrations = {${nextBody}} as const;`;
  });
}

async function updatePackageJson(input: {
  root: string;
  dryRun?: boolean;
  result: AddFarmIntegrationResult;
}) {
  const packageJsonPath = path.join(input.root, "package.json");
  if (!existsSync(packageJsonPath)) {
    input.result.skipped.push(packageJsonPath);
    return;
  }

  const source = await readFile(packageJsonPath, "utf8");
  const manifest = JSON.parse(source) as PackageManifest;

  if (hasPackageDependency(manifest, "@farmjs/integrations")) {
    input.result.packageJson = packageJsonPath;
    input.result.skipped.push(packageJsonPath);
    return;
  }

  manifest.dependencies = {
    ...manifest.dependencies,
    "@farmjs/integrations": getFarmIntegrationsVersion(manifest),
  };

  if (!input.dryRun) {
    await writeFile(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  input.result.packageJson = packageJsonPath;
  input.result.updated.push(packageJsonPath);
}

async function updateFarmConfig(input: {
  root: string;
  registryFile: string;
  dryRun?: boolean;
  result: AddFarmIntegrationResult;
}) {
  const configFile = findFarmConfig(input.root);

  if (!configFile) {
    const newConfigFile = path.join(input.root, "farm.config.ts");
    const importPath = toImportPath(path.relative(input.root, input.registryFile));
    const source = `import { defineConfig } from "@farmjs/core";
import { appIntegrations } from "${importPath}";

export default defineConfig({
  integrations: appIntegrations,
});
`;

    if (!input.dryRun) {
      await writeFile(newConfigFile, source, "utf8");
    }

    input.result.configFile = newConfigFile;
    input.result.created.push(newConfigFile);
    return;
  }

  input.result.configFile = configFile;
  const source = await readFile(configFile, "utf8");
  if (/\bintegrations\s*:/.test(source)) {
    input.result.skipped.push(configFile);
    input.result.notes.push(
      `farm.config already has an integrations field. Confirm it includes appIntegrations from ${path.relative(input.root, input.registryFile)}.`,
    );
    return;
  }

  const importPath = toImportPath(path.relative(path.dirname(configFile), input.registryFile));
  const importLine = `import { appIntegrations } from "${importPath}";`;
  const sourceWithImport = source.includes(importLine) ? source : `${importLine}\n${source}`;
  const nextSource = insertIntegrationsConfig(sourceWithImport);

  if (nextSource === sourceWithImport) {
    input.result.skipped.push(configFile);
    input.result.notes.push(
      `Could not safely update ${path.relative(input.root, configFile)}. Add integrations: appIntegrations manually.`,
    );
    return;
  }

  if (!input.dryRun) {
    await writeFile(configFile, nextSource, "utf8");
  }

  input.result.updated.push(configFile);
}

function insertIntegrationsConfig(source: string) {
  const defineConfigCall = /\bdefine(?:Farm)?Config\s*\(\s*\{/;
  if (defineConfigCall.test(source)) {
    return source.replace(defineConfigCall, (match) => {
      return `${match}\n  integrations: appIntegrations,`;
    });
  }

  if (/export\s+default\s+\{/.test(source)) {
    return source.replace(/export\s+default\s+\{/, (match) => {
      return `${match}\n  integrations: appIntegrations,`;
    });
  }

  return source;
}

function findFarmConfig(root: string) {
  const candidates = [
    "farm.config.ts",
    "farm.config.mts",
    "farm.config.js",
    "farm.config.mjs",
    "config.ts",
    "config.mts",
    "config.js",
    "config.mjs",
  ];
  for (const candidate of candidates) {
    const absolutePath = path.join(root, candidate);
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  return null;
}

function hasPackageDependency(manifest: PackageManifest, dependency: string) {
  return (
    dependency in (manifest.dependencies || {}) ||
    dependency in (manifest.devDependencies || {}) ||
    dependency in (manifest.peerDependencies || {}) ||
    dependency in (manifest.optionalDependencies || {})
  );
}

function getFarmIntegrationsVersion(manifest: PackageManifest) {
  const farmCoreVersion =
    manifest.dependencies?.["@farmjs/core"] ??
    manifest.devDependencies?.["@farmjs/core"] ??
    manifest.peerDependencies?.["@farmjs/core"] ??
    manifest.optionalDependencies?.["@farmjs/core"];

  return farmCoreVersion?.startsWith("workspace:") ? "workspace:*" : "latest";
}

function toImportPath(relativePath: string) {
  const normalized = relativePath.split(path.sep).join("/");
  const withDot = normalized.startsWith(".") ? normalized : `./${normalized}`;
  return withDot.replace(/\.tsx?$/, ".ts");
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
