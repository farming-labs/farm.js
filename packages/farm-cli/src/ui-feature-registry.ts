import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AddFarmIntegrationResult, FarmIntegrationProvider } from "./add-integration";

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export interface AddFarmIntegrationUIResult {
  feature: string;
  components: string[];
  files: string[];
}

export type ShadcnComponentName = "badge" | "button" | "card" | "input" | "label";

export interface UIFeatureDefinition {
  name: string;
  description: string;
  components: readonly ShadcnComponentName[];
  files(input: UIFeatureTemplateInput): readonly UIFeatureFile[];
  needsApiClient?: boolean;
  notes?: readonly string[];
}

interface UIFeatureTemplateInput {
  key: string;
  provider: FarmIntegrationProvider;
}

interface UIFeatureFile {
  path: string;
  source: string;
}

export async function installUIFeature(input: {
  root: string;
  definition: { provider: FarmIntegrationProvider; ui?: UIFeatureDefinition };
  key: string;
  dryRun?: boolean;
  force?: boolean;
  skipPackageJson?: boolean;
  result: AddFarmIntegrationResult;
}) {
  const feature = input.definition.ui;
  if (!feature) {
    input.result.notes.push(
      `No --ui feature pack is available for ${input.definition.provider} yet.`,
    );
    return;
  }

  input.result.ui = {
    feature: feature.name,
    components: [...feature.components],
    files: [],
  };
  input.result.notes.push(
    `Installed ${feature.description} with shadcn-style local source components.`,
    ...(feature.notes || []),
  );

  await ensureComponentsJson({
    root: input.root,
    dryRun: input.dryRun,
    result: input.result,
  });
  await ensureShadcnGlobals({
    root: input.root,
    dryRun: input.dryRun,
    result: input.result,
  });
  await ensureTsconfigAlias({
    root: input.root,
    dryRun: input.dryRun,
    result: input.result,
  });

  if (!input.skipPackageJson) {
    await updateUIPackageJson({
      root: input.root,
      dryRun: input.dryRun,
      result: input.result,
    });
  }

  await writeGeneratedFile({
    root: input.root,
    relativePath: path.join("src", "lib", "utils.ts"),
    source: shadcnUtilsTemplate(),
    dryRun: input.dryRun,
    force: input.force,
    result: input.result,
  });

  for (const component of feature.components) {
    await writeGeneratedFile({
      root: input.root,
      relativePath: path.join("src", "components", "ui", `${component}.tsx`),
      source: shadcnComponentTemplate(component),
      dryRun: input.dryRun,
      force: input.force,
      result: input.result,
    });
  }

  if (feature.needsApiClient !== false) {
    await writeGeneratedFile({
      root: input.root,
      relativePath: path.join("src", "lib", "api.ts"),
      source: apiClientTemplate(),
      dryRun: input.dryRun,
      force: input.force,
      result: input.result,
    });
  }

  for (const file of feature.files({
    key: input.key,
    provider: input.definition.provider,
  })) {
    await writeGeneratedFile({
      root: input.root,
      relativePath: file.path,
      source: file.source,
      dryRun: input.dryRun,
      force: input.force,
      result: input.result,
    });
  }
}

export function stripeBillingUIFeature(): UIFeatureDefinition {
  return billingUIFeature({
    provider: "stripe",
    label: "Stripe",
  });
}

export function polarBillingUIFeature(): UIFeatureDefinition {
  return billingUIFeature({
    provider: "polar",
    label: "Polar",
  });
}

export function autumnBillingUIFeature(): UIFeatureDefinition {
  return billingUIFeature({
    provider: "autumn",
    label: "Autumn",
  });
}

export function aiChatUIFeature(): UIFeatureDefinition {
  return {
    name: "ai-chat",
    description: "AI chat UI",
    components: ["badge", "button", "card", "input"],
    needsApiClient: false,
    notes: ['Open "/integrations/ai" to try the generated chat UI.'],
    files: () => [
      componentFile("ai-chat.tsx", aiChatTemplate()),
      integrationPageFile("ai", "AIChat"),
    ],
  };
}

export function supabaseAuthUIFeature(): UIFeatureDefinition {
  return {
    name: "supabase-auth",
    description: "Supabase auth UI",
    components: ["badge", "button", "card", "input", "label"],
    notes: ['Open "/integrations/supabase" to try the generated auth UI.'],
    files: (input) => [
      componentFile("supabase-auth-panel.tsx", supabaseAuthTemplate(input.key)),
      integrationPageFile("supabase", "SupabaseAuthPanel"),
    ],
  };
}

export function workosAuthUIFeature(): UIFeatureDefinition {
  return {
    name: "workos-auth",
    description: "WorkOS auth UI",
    components: ["badge", "button", "card"],
    notes: ['Open "/integrations/workos" to try the generated auth UI.'],
    files: (input) => [
      componentFile(
        "workos-auth-panel.tsx",
        hostedAuthTemplate({
          key: input.key,
          provider: "WorkOS",
          componentName: "WorkOSAuthPanel",
          statusCall: "session.get",
          logoutCall: "logout.post",
          loginHref: "/login?returnTo=/dashboard",
          signupHref: "/signup?returnTo=/dashboard",
          statusLabel: "Session",
        }),
      ),
      integrationPageFile("workos", "WorkOSAuthPanel"),
    ],
  };
}

export function auth0AuthUIFeature(): UIFeatureDefinition {
  return {
    name: "auth0-auth",
    description: "Auth0 auth UI",
    components: ["badge", "button", "card"],
    notes: ['Open "/integrations/auth0" to try the generated auth UI.'],
    files: (input) => [
      componentFile(
        "auth0-auth-panel.tsx",
        hostedAuthTemplate({
          key: input.key,
          provider: "Auth0",
          componentName: "Auth0AuthPanel",
          statusCall: "profile.get",
          logoutCall: "logout.get",
          loginHref: "/auth/login?returnTo=/dashboard",
          signupHref: "/auth/signup?returnTo=/dashboard",
          statusLabel: "Profile",
        }),
      ),
      integrationPageFile("auth0", "Auth0AuthPanel"),
    ],
  };
}

export function clerkAuthUIFeature(): UIFeatureDefinition {
  return authRouteShellUIFeature({
    provider: "clerk",
    label: "Clerk",
    componentName: "ClerkAuthPanel",
    signInHref: "/sign-in",
    signUpHref: "/sign-up",
    sessionHref: "/dashboard",
  });
}

export function betterAuthUIFeature(): UIFeatureDefinition {
  return {
    name: "better-auth-auth",
    description: "Better Auth email and password UI",
    components: ["badge", "button", "card", "input", "label"],
    needsApiClient: false,
    notes: ['Open "/integrations/better-auth" to try the generated auth UI.'],
    files: () => [
      {
        path: path.join("src", "lib", "auth-client.ts"),
        source: betterAuthClientTemplate(),
      },
      componentFile("better-auth-panel.tsx", betterAuthPanelTemplate()),
      integrationPageFile("better-auth", "BetterAuthPanel"),
    ],
  };
}

export function authjsUIFeature(): UIFeatureDefinition {
  return authRouteShellUIFeature({
    provider: "authjs",
    label: "Auth.js",
    componentName: "AuthJsPanel",
    signInHref: "/api/auth/signin",
    signUpHref: "/api/auth/signin",
    sessionHref: "/api/auth/session",
  });
}

export function resendEmailUIFeature(): UIFeatureDefinition {
  return {
    name: "resend-email",
    description: "Resend email console UI",
    components: ["badge", "button", "card", "input", "label"],
    notes: ['Open "/integrations/resend" to try the generated email UI.'],
    files: (input) => [
      componentFile("resend-email-console.tsx", resendEmailTemplate(input.key)),
      integrationPageFile("resend", "ResendEmailConsole"),
    ],
  };
}

export function jobsUIFeature(provider: "inngest" | "trigger"): UIFeatureDefinition {
  const label = provider === "inngest" ? "Inngest" : "Trigger.dev";

  return {
    name: `${provider}-jobs`,
    description: `${label} jobs console UI`,
    components: ["badge", "button", "card", "input", "label"],
    notes: [`Open "/integrations/jobs-${provider}" to try the generated jobs UI.`],
    files: (input) => [
      componentFile(
        `${provider}-jobs-console.tsx`,
        jobsConsoleTemplate(input.key, label, provider),
      ),
      integrationPageFile(`jobs-${provider}`, `${pascalCase(provider)}JobsConsole`),
    ],
  };
}

export function unkeyApiKeysUIFeature(): UIFeatureDefinition {
  return {
    name: "unkey-api-keys",
    description: "Unkey API key console UI",
    components: ["badge", "button", "card", "input", "label"],
    notes: ['Open "/integrations/unkey" to try the generated API key UI.'],
    files: (input) => [
      componentFile("unkey-api-keys-console.tsx", unkeyApiKeysTemplate(input.key)),
      integrationPageFile("unkey", "UnkeyApiKeysConsole"),
    ],
  };
}

function billingUIFeature(input: { provider: "stripe" | "polar" | "autumn"; label: string }) {
  return {
    name: `${input.provider}-billing`,
    description: `${input.label} pricing and checkout UI`,
    components: ["badge", "button", "card"],
    notes: [
      `Open "/integrations/${input.provider}" to try the generated ${input.label} billing UI.`,
    ],
    files: (templateInput) => [
      componentFile(
        `${input.provider}-billing.tsx`,
        billingPricingTemplate({
          key: templateInput.key,
          provider: input.provider,
          label: input.label,
          componentName: `${pascalCase(input.provider)}Billing`,
        }),
      ),
      integrationPageFile(input.provider, `${pascalCase(input.provider)}Billing`),
    ],
  };
}

function authRouteShellUIFeature(input: {
  provider: "authjs" | "better-auth" | "clerk";
  label: string;
  componentName: string;
  signInHref: string;
  signUpHref: string;
  sessionHref: string;
}): UIFeatureDefinition {
  return {
    name: `${input.provider}-auth`,
    description: `${input.label} auth UI`,
    components: ["badge", "button", "card"],
    notes: [`Open "/integrations/${input.provider}" to try the generated auth UI.`],
    files: () => [
      componentFile(
        `${input.provider}-auth-panel.tsx`,
        authRouteShellTemplate({
          provider: input.label,
          componentName: input.componentName,
          signInHref: input.signInHref,
          signUpHref: input.signUpHref,
          sessionHref: input.sessionHref,
        }),
      ),
      integrationPageFile(input.provider, input.componentName),
    ],
  };
}

function componentFile(fileName: string, source: string): UIFeatureFile {
  return {
    path: path.join("src", "components", "farm", fileName),
    source,
  };
}

function integrationPageFile(provider: string, componentName: string): UIFeatureFile {
  const fileName = kebabCase(componentName);

  return {
    path: path.join("src", "app", "integrations", provider, "page.tsx"),
    source: `import { ${componentName} } from "@/components/farm/${fileName}";

export default function ${componentName}Page() {
  return <${componentName} />;
}
`,
  };
}

async function writeGeneratedFile(input: {
  root: string;
  relativePath: string;
  source: string;
  dryRun?: boolean;
  force?: boolean;
  result: AddFarmIntegrationResult;
}) {
  const absolutePath = path.join(input.root, input.relativePath);
  const exists = existsSync(absolutePath);
  const source = resolveGeneratedAliases(input.source, input.relativePath);
  input.result.ui?.files.push(absolutePath);

  if (exists && !input.force) {
    pushResultPath(input.result.skipped, absolutePath);
    return;
  }

  if (!input.dryRun) {
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, source, "utf8");
  }

  pushResultPath(exists ? input.result.updated : input.result.created, absolutePath);
}

function resolveGeneratedAliases(source: string, relativePath: string) {
  const sourceDirectory = path.dirname(relativePath);

  return source.replace(/(["'])@\/([^"']+)\1/g, (_match, quote: string, target: string) => {
    const relativeTarget = path
      .relative(sourceDirectory, path.join("src", target))
      .split(path.sep)
      .join("/");
    const importPath = relativeTarget.startsWith(".") ? relativeTarget : `./${relativeTarget}`;
    return `${quote}${importPath}${quote}`;
  });
}

async function ensureComponentsJson(input: {
  root: string;
  dryRun?: boolean;
  result: AddFarmIntegrationResult;
}) {
  const componentsJsonPath = path.join(input.root, "components.json");
  input.result.ui?.files.push(componentsJsonPath);
  const defaults = createComponentsJson();

  if (!existsSync(componentsJsonPath)) {
    if (!input.dryRun) {
      await writeFile(componentsJsonPath, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
    }
    pushResultPath(input.result.created, componentsJsonPath);
    return;
  }

  let current: Record<string, unknown>;
  try {
    current = JSON.parse(await readFile(componentsJsonPath, "utf8")) as Record<string, unknown>;
  } catch {
    pushResultPath(input.result.skipped, componentsJsonPath);
    input.result.notes.push(
      "components.json could not be parsed. Keep shadcn aliases pointed at src/components and src/lib/utils.",
    );
    return;
  }

  const next = mergeComponentsJson(current, defaults);
  if (JSON.stringify(current) === JSON.stringify(next)) {
    pushResultPath(input.result.skipped, componentsJsonPath);
    return;
  }

  if (!input.dryRun) {
    await writeFile(componentsJsonPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }
  pushResultPath(input.result.updated, componentsJsonPath);
}

async function ensureShadcnGlobals(input: {
  root: string;
  dryRun?: boolean;
  result: AddFarmIntegrationResult;
}) {
  const globalsPath = path.join(input.root, "src", "app", "globals.css");
  input.result.ui?.files.push(globalsPath);

  if (!existsSync(globalsPath)) {
    const source = `@import "tailwindcss";

${SHADCN_THEME_CSS}
`;
    if (!input.dryRun) {
      await mkdir(path.dirname(globalsPath), { recursive: true });
      await writeFile(globalsPath, source, "utf8");
    }
    pushResultPath(input.result.created, globalsPath);
    return;
  }

  const source = await readFile(globalsPath, "utf8");
  const hasTailwindImport = source.includes('@import "tailwindcss"');
  const hasTheme = source.includes("--color-background") || source.includes("--background:");
  if (hasTailwindImport && hasTheme) {
    pushResultPath(input.result.skipped, globalsPath);
    return;
  }

  const nextSource = `${hasTailwindImport ? "" : '@import "tailwindcss";\n\n'}${source.trimEnd()}${
    hasTheme
      ? "\n"
      : `

${SHADCN_THEME_CSS}
`
  }`;
  if (!input.dryRun) {
    await writeFile(globalsPath, nextSource, "utf8");
  }
  pushResultPath(input.result.updated, globalsPath);
}

async function ensureTsconfigAlias(input: {
  root: string;
  dryRun?: boolean;
  result: AddFarmIntegrationResult;
}) {
  const tsconfigPath = path.join(input.root, "tsconfig.json");
  input.result.ui?.files.push(tsconfigPath);
  const defaults = {
    compilerOptions: {
      baseUrl: ".",
      paths: {
        "@/*": ["./src/*"],
      },
    },
  };

  if (!existsSync(tsconfigPath)) {
    if (!input.dryRun) {
      await writeFile(tsconfigPath, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
    }
    pushResultPath(input.result.created, tsconfigPath);
    return;
  }

  let tsconfig: Record<string, unknown>;
  try {
    tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8")) as Record<string, unknown>;
  } catch {
    pushResultPath(input.result.skipped, tsconfigPath);
    input.result.notes.push(
      'tsconfig.json could not be parsed. Add paths: { "@/*": ["./src/*"] } manually.',
    );
    return;
  }

  const compilerOptions = readObject(tsconfig.compilerOptions);
  const paths = readObject(compilerOptions.paths);
  const nextCompilerOptions = {
    ...compilerOptions,
    baseUrl: typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : ".",
    paths: {
      ...paths,
      "@/*": ["./src/*"],
    },
  };
  const nextTsconfig = {
    ...tsconfig,
    compilerOptions: nextCompilerOptions,
  };

  if (JSON.stringify(tsconfig) === JSON.stringify(nextTsconfig)) {
    pushResultPath(input.result.skipped, tsconfigPath);
    return;
  }

  if (!input.dryRun) {
    await writeFile(tsconfigPath, `${JSON.stringify(nextTsconfig, null, 2)}\n`, "utf8");
  }
  pushResultPath(input.result.updated, tsconfigPath);
}

async function updateUIPackageJson(input: {
  root: string;
  dryRun?: boolean;
  result: AddFarmIntegrationResult;
}) {
  const packageJsonPath = path.join(input.root, "package.json");
  input.result.ui?.files.push(packageJsonPath);
  if (!existsSync(packageJsonPath)) {
    pushResultPath(input.result.skipped, packageJsonPath);
    return;
  }

  const source = await readFile(packageJsonPath, "utf8");
  const manifest = JSON.parse(source) as PackageManifest;
  let changed = false;

  for (const [dependency, version] of Object.entries(UI_DEPENDENCIES)) {
    if (hasPackageDependency(manifest, dependency)) {
      continue;
    }

    manifest.dependencies = {
      ...manifest.dependencies,
      [dependency]: version,
    };
    changed = true;
  }

  if (!changed) {
    pushResultPath(input.result.skipped, packageJsonPath);
    return;
  }

  if (!input.dryRun) {
    await writeFile(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  input.result.packageJson = packageJsonPath;
  pushResultPath(input.result.updated, packageJsonPath);
}

const UI_DEPENDENCIES = {
  "class-variance-authority": "^0.7.1",
  clsx: "^2.1.1",
  "tailwind-merge": "^3.3.1",
  tailwindcss: "^4.1.18",
} as const;

const SHADCN_THEME_CSS = `@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
}

:root {
  --radius: 0.5rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  body {
    @apply bg-background text-foreground;
  }
}`;

function createComponentsJson() {
  return {
    $schema: "https://ui.shadcn.com/schema.json",
    style: "new-york",
    rsc: true,
    tsx: true,
    tailwind: {
      config: "",
      css: "src/app/globals.css",
      baseColor: "zinc",
      cssVariables: true,
    },
    aliases: {
      components: "@/components",
      utils: "@/lib/utils",
      ui: "@/components/ui",
      lib: "@/lib",
      hooks: "@/hooks",
    },
    registries: {
      farm: {
        url: "https://farmjs.dev/r/{name}.json",
      },
    },
  };
}

function mergeComponentsJson(
  current: Record<string, unknown>,
  defaults: ReturnType<typeof createComponentsJson>,
) {
  const aliases = readObject(current.aliases);
  const tailwind = readObject(current.tailwind);
  const registries = readObject(current.registries);

  return {
    ...current,
    $schema: typeof current.$schema === "string" ? current.$schema : defaults.$schema,
    style: typeof current.style === "string" ? current.style : defaults.style,
    rsc: typeof current.rsc === "boolean" ? current.rsc : defaults.rsc,
    tsx: typeof current.tsx === "boolean" ? current.tsx : defaults.tsx,
    tailwind: {
      ...defaults.tailwind,
      ...tailwind,
    },
    aliases: {
      ...defaults.aliases,
      ...aliases,
    },
    registries: {
      ...registries,
      farm: readObject(registries.farm).url ? registries.farm : defaults.registries.farm,
    },
  };
}

function shadcnUtilsTemplate() {
  return `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;
}

function apiClientTemplate() {
  return `import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>();
`;
}

function shadcnComponentTemplate(component: ShadcnComponentName) {
  switch (component) {
    case "badge":
      return `import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
`;
    case "button":
      return `import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
`;
    case "card":
      return `import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-2xl font-semibold leading-none tracking-normal", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";
`;
    case "input":
      return `import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";
`;
    case "label":
      return `import * as React from "react";
import { cn } from "@/lib/utils";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
      {...props}
    />
  ),
);
Label.displayName = "Label";
`;
  }
}

function billingPricingTemplate(input: {
  key: string;
  provider: "stripe" | "polar" | "autumn";
  label: string;
  componentName: string;
}) {
  return `"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiClient } from "@/lib/api";

type BillingProduct = NonNullable<Awaited<ReturnType<typeof apiClient.${input.key}.products>>["data"]>[number];

export function ${input.componentName}() {
  const [products, setProducts] = React.useState<BillingProduct[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [checkingOut, setCheckingOut] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    async function loadProducts() {
      setLoading(true);
      setError(null);

      try {
        const response = await apiClient.${input.key}.products();
        if (response.error) {
          throw new Error(readErrorMessage(response.error, "${input.label} request failed."));
        }

        if (active) {
          setProducts(Array.from(response.data ?? []));
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Could not load ${input.label} products.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadProducts();

    return () => {
      active = false;
    };
  }, []);

  async function startCheckout(product: BillingProduct) {
    const productId = String(readProductField(product, "id") ?? "");
    if (!productId) {
      setError("This Stripe product is missing an id.");
      return;
    }

    setCheckingOut(productId);
    setError(null);

    try {
      const response = await apiClient.${input.key}.checkout({
        body: {
          productId,
          successPath: "/billing/success",
          cancelPath: "/integrations/${input.provider}",
        },
      });
      if (response.error) {
        throw new Error(readErrorMessage(response.error, "${input.label} checkout failed."));
      }

      const redirectTo = response.data?.redirectTo;
      if (!redirectTo) {
        throw new Error("${input.label} checkout did not return a redirect URL.");
      }

      window.location.assign(redirectTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start ${input.label} checkout.");
      setCheckingOut(null);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <div className="max-w-2xl space-y-3">
          <Badge variant="secondary">${input.label}</Badge>
          <h1 className="text-3xl font-semibold tracking-normal">${input.label} billing</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Plans, checkout, and customer billing actions in one place.
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index} className="min-h-[220px] animate-pulse" />
            ))}
          </div>
        ) : products.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => {
              const productId = String(readProductField(product, "id") ?? "");
              const fallbackName = productId || "Product";
              const name = String(readProductField(product, "name") ?? fallbackName);
              const description =
                readProductField(product, "description") ?? "Connected to your Stripe catalog.";

              return (
                <Card key={productId || name} className="flex min-h-[260px] flex-col">
                  <CardHeader>
                    <CardTitle className="text-xl">{name}</CardTitle>
                    <CardDescription>{String(description)}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <div className="text-3xl font-semibold">{formatProductPrice(product)}</div>
                  </CardContent>
                  <CardFooter>
                    <Button
                      className="w-full"
                      disabled={!productId || checkingOut === productId}
                      onClick={() => void startCheckout(product)}
                    >
                      {checkingOut === productId ? "Starting checkout..." : "Checkout"}
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>No products yet</CardTitle>
              <CardDescription>
                Add products to the generated ${input.label} integration template or provider dashboard.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </section>
    </main>
  );
}

function readProductField(product: BillingProduct, field: string) {
  return (product as Record<string, unknown>)[field];
}

function formatProductPrice(product: BillingProduct) {
  const amount = readProductField(product, "amount") ?? readProductField(product, "unitAmount");
  const currency = String(readProductField(product, "currency") ?? "USD").toUpperCase();
  const interval = readProductField(product, "interval");

  if (typeof amount === "number" && Number.isFinite(amount)) {
    const formatted = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).format(amount / 100);

    return interval ? \`\${formatted}/\${String(interval)}\` : formatted;
  }

  return "Custom";
}

function readErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }

  return fallback;
}
`;
}

function aiChatTemplate() {
  return `"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export function AIChat() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextInput = input.trim();
    if (!nextInput) {
      return;
    }

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: nextInput }];
    setMessages(nextMessages);
    setInput("");
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: nextMessages.map((message) => ({
            role: message.role,
            parts: [{ type: "text", text: message.content }],
          })),
        }),
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(text || "AI request failed.");
      }

      setMessages([...nextMessages, { role: "assistant", content: text || "Done." }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI request failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="space-y-3">
          <Badge variant="secondary">AI</Badge>
          <h1 className="text-3xl font-semibold tracking-normal">Chat</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Conversation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="min-h-[320px] space-y-3 rounded-md border bg-muted/30 p-4">
              {messages.length ? (
                messages.map((message, index) => (
                  <div
                    key={index}
                    className={message.role === "user" ? "ml-auto max-w-[85%] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" : "max-w-[85%] rounded-md bg-background px-3 py-2 text-sm"}
                  >
                    {message.content}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Start a conversation.</p>
              )}
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <form className="flex gap-2" onSubmit={sendMessage}>
              <Input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask something..."
              />
              <Button disabled={pending} type="submit">
                {pending ? "Sending..." : "Send"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
`;
}

function supabaseAuthTemplate(key: string) {
  return `"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api";

export function SupabaseAuthPanel() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [mode, setMode] = React.useState<"login" | "signup">("login");
  const [pending, setPending] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatus(null);

    const response =
      mode === "login"
        ? await apiClient.${key}.login.post({ body: { email, password, returnTo: "/dashboard" } })
        : await apiClient.${key}.signup.post({ body: { email, password, returnTo: "/dashboard" } });

    if (response.error) {
      setStatus(response.error.message);
      setPending(false);
      return;
    }

    if (response.data?.redirectTo) {
      window.location.assign(response.data.redirectTo);
      return;
    }

    setStatus(response.data?.message ?? "Check your email to continue.");
    setPending(false);
  }

  async function loadSession() {
    const response = await apiClient.${key}.session.get();
    setStatus(response.error ? response.error.message : response.data?.authenticated ? "Authenticated" : "No active session");
  }

  async function logout() {
    const response = await apiClient.${key}.logout.post({ body: { returnTo: "/" } });
    if (response.data?.redirectTo) {
      window.location.assign(response.data.redirectTo);
      return;
    }
    setStatus(response.error?.message ?? "Signed out");
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div className="space-y-3">
          <Badge variant="secondary">Supabase</Badge>
          <h1 className="text-3xl font-semibold tracking-normal">Auth</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{mode === "login" ? "Sign in" : "Create account"}</CardTitle>
            <CardDescription>Email and password access for this app.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
              </div>
              {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button disabled={pending} type="submit">{pending ? "Working..." : mode === "login" ? "Sign in" : "Sign up"}</Button>
                <Button type="button" variant="outline" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
                  {mode === "login" ? "Use sign up" : "Use sign in"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => void loadSession()}>Session</Button>
                <Button type="button" variant="ghost" onClick={() => void logout()}>Logout</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
`;
}

function hostedAuthTemplate(input: {
  key: string;
  provider: string;
  componentName: string;
  statusCall: string;
  logoutCall: string;
  loginHref: string;
  signupHref: string;
  statusLabel: string;
}) {
  return `"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient } from "@/lib/api";

export function ${input.componentName}() {
  const [status, setStatus] = React.useState<string>("Idle");
  const [pending, setPending] = React.useState(false);

  async function refreshStatus() {
    setPending(true);
    const response = await apiClient.${input.key}.${input.statusCall}();
    if (response.error) {
      setStatus(response.error.message);
    } else {
      setStatus(response.data?.authenticated ? "Authenticated" : "No active session");
    }
    setPending(false);
  }

  async function logout() {
    setPending(true);
    const response = await apiClient.${input.key}.${input.logoutCall}();
    if (response.data?.redirectTo) {
      window.location.assign(response.data.redirectTo);
      return;
    }
    setStatus(response.error?.message ?? "Signed out");
    setPending(false);
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="space-y-3">
          <Badge variant="secondary">${input.provider}</Badge>
          <h1 className="text-3xl font-semibold tracking-normal">Auth</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">${input.provider} session</CardTitle>
            <CardDescription>Hosted auth, account session, and sign-out controls.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{status}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => window.location.assign("${input.loginHref}")}>Sign in</Button>
              <Button type="button" variant="outline" onClick={() => window.location.assign("${input.signupHref}")}>Sign up</Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => void refreshStatus()}>Refresh</Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => void logout()}>Logout</Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
`;
}

function authRouteShellTemplate(input: {
  provider: string;
  componentName: string;
  signInHref: string;
  signUpHref: string;
  sessionHref: string;
}) {
  return `"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ${input.componentName}() {
  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="space-y-3">
          <Badge variant="secondary">${input.provider}</Badge>
          <h1 className="text-3xl font-semibold tracking-normal">Auth</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">${input.provider} routes</CardTitle>
            <CardDescription>Account entry points and session route.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => window.location.assign("${input.signInHref}")}>Sign in</Button>
            <Button type="button" variant="outline" onClick={() => window.location.assign("${input.signUpHref}")}>Sign up</Button>
            <Button type="button" variant="ghost" onClick={() => window.location.assign("${input.sessionHref}")}>Session</Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
`;
}

function betterAuthClientTemplate() {
  return `import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: "",
});
`;
}

function betterAuthPanelTemplate() {
  return `"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type Mode = "sign-in" | "sign-up";

export function BetterAuthPanel() {
  const [mode, setMode] = React.useState<Mode>("sign-in");
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState("Ready");
  const [sessionEmail, setSessionEmail] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(mode === "sign-in" ? "Signing in…" : "Creating account…");

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");
    const name = String(form.get("name") || "");
    try {
      const response =
        mode === "sign-in"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name });

      if (response.error) {
        setMessage(response.error.message || "Authentication failed.");
        return;
      }

      setSessionEmail(email);
      setMessage(mode === "sign-in" ? "Signed in." : "Account created.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not reach the auth server.");
    } finally {
      setPending(false);
    }
  }

  async function refreshSession() {
    setPending(true);
    try {
      const response = await authClient.getSession();
      setSessionEmail(response.data?.user.email || null);
      setMessage(response.error?.message || (response.data ? "Session active." : "No active session."));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not read the session.");
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    try {
      const response = await authClient.signOut();
      if (response.error) {
        setMessage(response.error.message || "Could not sign out.");
        return;
      }
      setSessionEmail(null);
      setMessage("Signed out.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not reach the auth server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground sm:px-8">
      <section className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-[1fr_420px] lg:items-start">
        <div className="space-y-5 py-4">
          <Badge variant="secondary">Better Auth × Farm.js</Badge>
          <div className="space-y-3">
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">
              Authentication that starts ready.
            </h1>
            <p className="max-w-xl text-base leading-7 text-muted-foreground">
              Test account creation, email sign-in, session reads, and sign-out through Farm’s
              generated Better Auth integration.
            </p>
          </div>
          <div aria-live="polite" className="border-l-2 border-primary pl-4 text-sm">
            <p className="font-medium">{message}</p>
            <p className="mt-1 text-muted-foreground">
              {sessionEmail ? \`Signed in as \${sessionEmail}\` : "No authenticated user"}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{mode === "sign-in" ? "Welcome back" : "Create an account"}</CardTitle>
            <CardDescription>
              {mode === "sign-in"
                ? "Enter your credentials to start a secure session."
                : "Use an email and password to create your local account."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              {mode === "sign-up" ? (
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input autoComplete="name" id="name" name="name" required />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input autoComplete="email" id="email" name="email" required type="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  id="password"
                  minLength={8}
                  name="password"
                  required
                  type="password"
                />
              </div>
              <Button className="w-full" disabled={pending} type="submit">
                {pending ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
              </Button>
            </form>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Button
                disabled={pending}
                type="button"
                variant="outline"
                onClick={() => {
                  setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                  setMessage("Ready");
                }}
              >
                {mode === "sign-in" ? "Create account" : "Use sign in"}
              </Button>
              <Button disabled={pending} type="button" variant="outline" onClick={() => void refreshSession()}>
                Check session
              </Button>
            </div>
            <Button
              className="mt-2 w-full"
              disabled={pending || !sessionEmail}
              type="button"
              variant="ghost"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
`;
}

function resendEmailTemplate(key: string) {
  return `"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api";

export function ResendEmailConsole() {
  const [to, setTo] = React.useState("");
  const [name, setName] = React.useState("Ada");
  const [templateId, setTemplateId] = React.useState("welcome");
  const [status, setStatus] = React.useState("Idle");
  const [previewHtml, setPreviewHtml] = React.useState("");

  async function loadTemplates() {
    const response = await apiClient.${key}.templates.get();
    setStatus(response.error ? response.error.message : "Templates: " + (response.data ?? []).map((item) => item.id).join(", "));
  }

  async function preview() {
    const response = await apiClient.${key}.preview.post({
      body: {
        templateId,
        data: { name },
      },
    });
    if (response.error) {
      setStatus(response.error.message);
      return;
    }
    setPreviewHtml(response.data?.html ?? "");
    setStatus(response.data?.subject ?? "Preview loaded");
  }

  async function send() {
    const response = await apiClient.${key}.send.post({
      body: {
        templateId,
        to,
        data: { name },
      },
    });
    setStatus(response.error ? response.error.message : "Sent " + (response.data?.id ?? "email"));
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="space-y-3">
          <Badge variant="secondary">Resend</Badge>
          <h1 className="text-3xl font-semibold tracking-normal">Email console</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Send template</CardTitle>
            <CardDescription>Template previews and delivery controls.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="templateId">Template</Label>
                <Input id="templateId" value={templateId} onChange={(event) => setTemplateId(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="to">To</Label>
                <Input id="to" value={to} onChange={(event) => setTo(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
            </div>
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{status}</p>
            {previewHtml ? <div className="max-h-64 overflow-auto rounded-md border p-3 text-sm" dangerouslySetInnerHTML={{ __html: previewHtml }} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void loadTemplates()}>Templates</Button>
              <Button type="button" variant="outline" onClick={() => void preview()}>Preview</Button>
              <Button type="button" onClick={() => void send()}>Send</Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
`;
}

function jobsConsoleTemplate(key: string, label: string, provider: "inngest" | "trigger") {
  const componentName = `${pascalCase(provider)}JobsConsole`;

  return `"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api";

type JobTask = {
  key: string;
  description?: string | null;
};

export function ${componentName}() {
  const [tasks, setTasks] = React.useState<JobTask[]>([]);
  const [taskKey, setTaskKey] = React.useState("");
  const [runId, setRunId] = React.useState("");
  const [status, setStatus] = React.useState("Idle");

  async function loadTasks() {
    const response = await apiClient.${key}.tasks.list();
    if (response.error) {
      setStatus(response.error.message);
      return;
    }
    const nextTasks = Array.from(response.data ?? []);
    setTasks(nextTasks);
    setTaskKey(nextTasks[0]?.key ?? "");
    setStatus(nextTasks.length ? "Tasks loaded" : "No tasks registered yet");
  }

  async function triggerTask() {
    const task = (apiClient.${key} as Record<string, any>)[taskKey];
    if (!task?.trigger) {
      setStatus("Select a task first.");
      return;
    }
    const response = await task.trigger({ body: { input: {} } });
    setStatus(response.error ? response.error.message : "Triggered " + (response.data?.runId ?? response.data?.id ?? taskKey));
  }

  async function checkStatus() {
    const task = (apiClient.${key} as Record<string, any>)[taskKey];
    if (!task?.status || !runId) {
      setStatus("Enter a task and run id.");
      return;
    }
    const response = await task.status({ query: { runId } });
    setStatus(response.error ? response.error.message : JSON.stringify(response.data));
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="space-y-3">
          <Badge variant="secondary">${label}</Badge>
          <h1 className="text-3xl font-semibold tracking-normal">Jobs console</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Tasks</CardTitle>
            <CardDescription>Task runs and status checks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="taskKey">Task key</Label>
                <Input id="taskKey" value={taskKey} onChange={(event) => setTaskKey(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="runId">Run id</Label>
                <Input id="runId" value={runId} onChange={(event) => setRunId(event.target.value)} />
              </div>
            </div>
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{status}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void loadTasks()}>Load tasks</Button>
              <Button type="button" onClick={() => void triggerTask()}>Trigger</Button>
              <Button type="button" variant="ghost" onClick={() => void checkStatus()}>Status</Button>
            </div>
            {tasks.length ? (
              <div className="grid gap-2">
                {tasks.map((task) => (
                  <button key={task.key} className="rounded-md border px-3 py-2 text-left text-sm" onClick={() => setTaskKey(task.key)} type="button">
                    {task.key}
                  </button>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
`;
}

function unkeyApiKeysTemplate(key: string) {
  return `"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api";

export function UnkeyApiKeysConsole() {
  const [name, setName] = React.useState("Development key");
  const [prefix, setPrefix] = React.useState("farm");
  const [apiKey, setApiKey] = React.useState("");
  const [status, setStatus] = React.useState("Idle");

  async function createKey() {
    const response = await apiClient.${key}.createKey.post({
      body: {
        name,
        prefix,
      },
    });
    if (response.error) {
      setStatus(response.error.message);
      return;
    }
    setApiKey(response.data?.key ?? "");
    setStatus("Created " + (response.data?.keyId ?? "key"));
  }

  async function verifyKey() {
    const response = await apiClient.${key}.verifyKey.post({
      body: {
        key: apiKey,
      },
    });
    setStatus(response.error ? response.error.message : response.data?.valid ? "Valid key" : "Invalid key");
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="space-y-3">
          <Badge variant="secondary">Unkey</Badge>
          <h1 className="text-3xl font-semibold tracking-normal">API keys</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Key console</CardTitle>
            <CardDescription>API key lifecycle controls.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prefix">Prefix</Label>
                <Input id="prefix" value={prefix} onChange={(event) => setPrefix(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiKey">API key</Label>
              <Input id="apiKey" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
            </div>
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{status}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void createKey()}>Create key</Button>
              <Button type="button" variant="outline" onClick={() => void verifyKey()}>Verify</Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
`;
}

function pascalCase(input: string) {
  return input
    .split(/[^A-Za-z0-9]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function kebabCase(input: string) {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function hasPackageDependency(manifest: PackageManifest, dependency: string) {
  return (
    dependency in (manifest.dependencies || {}) ||
    dependency in (manifest.devDependencies || {}) ||
    dependency in (manifest.peerDependencies || {}) ||
    dependency in (manifest.optionalDependencies || {})
  );
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pushResultPath(list: string[], filePath: string) {
  if (!list.includes(filePath)) {
    list.push(filePath);
  }
}
