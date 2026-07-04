export type DocTone = "note" | "tip" | "warn";

export interface DocCodeBlock {
  title?: string;
  language?: string;
  source: string;
}

export interface DocTable {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface DocCard {
  title: string;
  body: string;
  href?: string;
}

export interface DocCallout {
  tone?: DocTone;
  title: string;
  body: string;
}

export interface DocBlock {
  title: string;
  body?: readonly string[];
  bullets?: readonly string[];
  steps?: readonly string[];
  code?: DocCodeBlock;
  table?: DocTable;
  cards?: readonly DocCard[];
  callout?: DocCallout;
}

export interface DocPage {
  id: string;
  href: string;
  section: string;
  title: string;
  description: string;
  eyebrow?: string;
  blocks: readonly DocBlock[];
}

const quickstart = `pnpm create farm-app my-app
cd my-app
pnpm install
pnpm dev`;

export const docPages = [
  {
    id: "getting-started",
    href: "/docs/getting-started",
    section: "Start",
    title: "Getting Started",
    description:
      "Create a Farm.js app, understand the files that matter, and run the development server.",
    eyebrow: "Start here",
    blocks: [
      {
        title: "Create an app",
        body: [
          "Farm keeps the first project small: an app directory, a config file, package metadata, and TypeScript. Vite config and platform config are optional escape hatches, not required setup.",
        ],
        code: {
          title: "Terminal",
          language: "bash",
          source: quickstart,
        },
      },
      {
        title: "What you get",
        bullets: [
          "File-based routes in src/app.",
          "React rendering with pages, layouts, loading, error, and not-found boundaries.",
          "Typed Link hrefs generated from the route tree.",
          "API routes and a generated client for api.users.get style calls.",
          "Deployment output powered by Farm config instead of extra root files.",
        ],
      },
      {
        title: "Your first page",
        code: {
          title: "src/app/page.tsx",
          language: "tsx",
          source: `import type { PageProps } from "@farmjs/core";

export default function HomePage(_props: PageProps) {
  return <h1>Hello from Farm.js</h1>;
}`,
        },
      },
    ],
  },
  {
    id: "project-structure",
    href: "/docs/project-structure",
    section: "Start",
    title: "Project Structure",
    description:
      "The compact file layout Farm expects, plus the optional files you add only when the app needs them.",
    blocks: [
      {
        title: "Minimal shape",
        body: [
          "A Farm app can be as small as src, farm.config.ts, package.json, and tsconfig.json. The framework discovers pages, API routes, middleware, layouts, docs, markdown mirrors, and generated route types from there.",
        ],
        code: {
          title: "Minimal app",
          language: "txt",
          source: `my-app/
  src/
    app/
      layout.tsx
      page.tsx
  farm.config.ts
  package.json
  tsconfig.json`,
        },
      },
      {
        title: "Common folders",
        table: {
          headers: ["Path", "Purpose"],
          rows: [
            ["src/app", "Pages, nested layouts, API routes, route boundaries, middleware."],
            ["src/lib", "Shared server and client utilities."],
            ["src/components", "Reusable UI and client components."],
            ["src/farm-routes.d.ts", "Generated typed route union for Link."],
            ["farm.config.ts", "Framework config, integrations, docs, storage, deployment."],
          ],
        },
      },
      {
        title: "Optional files stay optional",
        body: [
          "Use vite.config.ts only when you need custom Vite behavior. Use platform files only when a deployment target requires provider-specific settings that Farm cannot infer.",
        ],
      },
    ],
  },
  {
    id: "configuration",
    href: "/docs/configuration",
    section: "Start",
    title: "Configuration",
    description:
      "Use farm.config.ts as the single project control plane for source paths, integrations, docs, storage, deployment, and framework behavior.",
    blocks: [
      {
        title: "Define config",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  srcDir: "src",
  deploy: {
    target: "vercel",
  },
  docs: {
    entry: "/docs",
  },
  md: {
    expose: ["/", "/pricing"],
    cache: 60,
  },
});`,
        },
      },
      {
        title: "Important options",
        table: {
          headers: ["Option", "Use it for"],
          rows: [
            ["srcDir", "Changing the app source folder from the default src."],
            ["integrations", "Registering built-in or custom integrations."],
            ["storage", "Providing storage clients and mounts for framework and integration code."],
            ["docs", "Serving the built-in docs runtime and docs API."],
            ["md", "Exposing markdown mirrors like /pricing.md."],
            ["deploy", "Selecting a target, preset, and output directory."],
            ["openapi", "Publishing API reference docs."],
          ],
        },
      },
      {
        title: "Next-style route exports",
        body: [
          "Farm route modules can expose compact rendering options directly on the page when the behavior belongs to that route.",
        ],
        code: {
          title: "src/app/blog/page.tsx",
          language: "tsx",
          source: `export const dynamic = "force-static";
export const revalidate = 60;

export default async function BlogPage() {
  return <main>...</main>;
}`,
        },
      },
    ],
  },
  {
    id: "routing",
    href: "/docs/routing",
    section: "Core",
    title: "Routing",
    description:
      "Farm uses an app directory routing model with static routes, dynamic segments, catch-all routes, and typed navigation.",
    blocks: [
      {
        title: "File routes",
        table: {
          headers: ["File", "URL"],
          rows: [
            ["src/app/page.tsx", "/"],
            ["src/app/about/page.tsx", "/about"],
            ["src/app/blog/[slug]/page.tsx", "/blog/:slug"],
            ["src/app/docs/[...slug]/page.tsx", "/docs/:slug*"],
          ],
        },
      },
      {
        title: "Dynamic params",
        code: {
          title: "src/app/users/[id]/page.tsx",
          language: "tsx",
          source: `import type { PageProps } from "@farmjs/core";

export default function UserPage({ params }: PageProps) {
  return <div>User: {params?.id}</div>;
}`,
        },
      },
      {
        title: "Typed navigation",
        body: [
          "Farm generates src/farm-routes.d.ts from your app tree. Link hrefs accept real routes, query strings, and hash fragments without widening everything to plain string.",
        ],
        code: {
          title: "Client navigation",
          language: "tsx",
          source: `import { Link } from "@farmjs/core/client";

export function Nav() {
  return (
    <>
      <Link href="/about">About</Link>
      <Link href="/blog/farm-routing?from=docs">Routing</Link>
    </>
  );
}`,
        },
      },
    ],
  },
  {
    id: "layouts",
    href: "/docs/layouts",
    section: "Core",
    title: "Layouts and Route Boundaries",
    description:
      "Wrap routes with root and nested layouts, then use loading, error, and not-found files for route-level UX.",
    blocks: [
      {
        title: "Root layout",
        code: {
          title: "src/app/layout.tsx",
          language: "tsx",
          source: `import type { LayoutProps } from "@farmjs/core";
import "./globals.css";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <main>
      <nav>Farm app</nav>
      {children}
    </main>
  );
}`,
        },
      },
      {
        title: "Nested layouts",
        body: [
          "A layout file wraps every page below its folder. Use this for dashboards, docs, account settings, or any area with shared navigation and chrome.",
        ],
        code: {
          title: "src/app/dashboard/layout.tsx",
          language: "tsx",
          source: `import type { LayoutProps } from "@farmjs/core";

export default function DashboardLayout({ children }: LayoutProps) {
  return (
    <div className="dashboard">
      <aside>Navigation</aside>
      <section>{children}</section>
    </div>
  );
}`,
        },
      },
      {
        title: "Route boundaries",
        bullets: [
          "loading.tsx provides pending UI for a route segment.",
          "error.tsx catches render failures in that segment.",
          "not-found.tsx renders when the route intentionally returns a 404.",
        ],
      },
    ],
  },
  {
    id: "server-rendering",
    href: "/docs/server-rendering",
    section: "Core",
    title: "Rendering Model",
    description:
      "Choose dynamic rendering, static rendering, ISR, or PPR with route-level exports and config.",
    blocks: [
      {
        title: "Rendering options",
        table: {
          headers: ["Mode", "How to opt in", "Best for"],
          rows: [
            ["Dynamic", "Default for request-bound pages", "Dashboards and personalized UI."],
            [
              "Static",
              "dynamic = force-static or use static directive",
              "Marketing pages and stable docs.",
            ],
            ["ISR", "revalidate = seconds", "Content that can refresh on a schedule."],
            ["PPR", "experimental_ppr = true", "Static shells with dynamic holes."],
          ],
        },
      },
      {
        title: "Route-level config",
        code: {
          title: "src/app/pricing/page.tsx",
          language: "tsx",
          source: `export const dynamic = "force-static";
export const revalidate = 300;

export default async function PricingPage() {
  return <main>Pricing</main>;
}`,
        },
      },
      {
        title: "Use directives when compactness wins",
        body: [
          "Farm also recognizes compact rendering directives at the top of route modules. This keeps small examples readable while preserving explicit exports for Next-style compatibility.",
        ],
        code: {
          title: "src/app/blog/page.tsx",
          language: "tsx",
          source: `"use ppr: 60";

export default function BlogPage() {
  return <main>Blog</main>;
}`,
        },
      },
    ],
  },
  {
    id: "middleware",
    href: "/docs/middleware",
    section: "Core",
    title: "Middleware",
    description:
      "Run request behavior before routes, pass request-scoped data to pages, and short-circuit with redirects or responses.",
    blocks: [
      {
        title: "Route middleware",
        body: [
          "Middleware can live near the routes it protects. Use it for auth, request metadata, A/B flags, rate limit checks, or headers that belong to an area of the app.",
        ],
        code: {
          title: "src/app/dashboard/middleware.ts",
          language: "ts",
          source: `import { defineMiddleware } from "@farmjs/core/middleware";

export default defineMiddleware(async ({ request, next, context }) => {
  context.data.set("request.startedAt", Date.now(), { exposeToPage: true });
  return next(request);
});`,
        },
      },
      {
        title: "Config matchers",
        body: ["Use farm.config.ts when middleware behavior should be described globally."],
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `export default defineFarmConfig({
  middleware: {
    matcher: ["/dashboard/:path*"],
  },
});`,
        },
      },
    ],
  },
  {
    id: "query",
    href: "/docs/query",
    section: "Data and APIs",
    title: "Query and Params",
    description:
      "Parse search params and route params with typed helpers on the server and synchronized state on the client.",
    blocks: [
      {
        title: "Server parsing",
        code: {
          title: "src/app/search/page.tsx",
          language: "tsx",
          source: `import type { PagePropsSafe } from "@farmjs/core/query";
import { asInteger, asString, loadSearchParams } from "@farmjs/core/query/server";

export default async function SearchPage({ searchParams }: PagePropsSafe) {
  const query = await loadSearchParams(searchParams, {
    q: asString.withDefault!(""),
    page: asInteger.withDefault!(1),
  });

  return <pre>{JSON.stringify(query, null, 2)}</pre>;
}`,
        },
      },
      {
        title: "Client query state",
        code: {
          title: "src/components/search-controls.tsx",
          language: "tsx",
          source: `"use client";

import { asString, useQueryState } from "@farmjs/core/query/client";

export function SearchControls() {
  const [q, setQ] = useQueryState("q", asString.withDefault!(""));
  return <input value={q} onChange={(event) => setQ(event.target.value)} />;
}`,
        },
      },
    ],
  },
  {
    id: "api-routes",
    href: "/docs/api-routes",
    section: "Data and APIs",
    title: "API Routes",
    description:
      "Expose HTTP handlers from src/app/api and validate input with schemas before handler code runs.",
    blocks: [
      {
        title: "Route handlers",
        body: [
          "API route modules export HTTP methods. Farm discovers them, runs the route pipeline, and can generate typed client callers from the route shape.",
        ],
        code: {
          title: "src/app/api/hello/route.ts",
          language: "ts",
          source: `import { createEndpoint } from "@farmjs/core/api";
import { z } from "zod";

export const POST = createEndpoint({
  body: z.object({
    name: z.string().min(1),
  }),
  async handler({ input }) {
    return Response.json({ message: "Hello " + input.body.name });
  },
});`,
        },
      },
      {
        title: "Next-style exports",
        body: [
          "You can also manually export GET, POST, PATCH, and other handlers from the route file. Farm keeps this familiar while layering typed helpers around it.",
        ],
        code: {
          title: "src/app/api/status/route.ts",
          language: "ts",
          source: `export async function GET() {
  return Response.json({ ok: true });
}`,
        },
      },
      {
        title: "Validation",
        callout: {
          tone: "tip",
          title: "Zod and standard schema",
          body: "Endpoint and integration route inputs can use Zod or compatible standard-schema validators so the handler sees parsed input instead of raw unknown data.",
        },
      },
    ],
  },
  {
    id: "api-client",
    href: "/docs/api-client",
    section: "Data and APIs",
    title: "API Client",
    description:
      "Call app API routes with api.hello.get style inference, cache policies, invalidation, retries, callbacks, and optimistic updates.",
    blocks: [
      {
        title: "Create the client",
        code: {
          title: "src/lib/api-client.ts",
          language: "ts",
          source: `import { createAPIClient } from "@farmjs/core/client";
import type { APIRouter } from "./api.generated";

export const api = createAPIClient<APIRouter>();`,
        },
      },
      {
        title: "Call a route",
        code: {
          title: "Browser usage",
          language: "ts",
          source: `const result = await api.hello.post({
  body: { name: "Ada" },
});

if (result.error) {
  console.error(result.error);
} else {
  console.log(result.data.message);
}`,
        },
      },
      {
        title: "Client options",
        bullets: [
          "cache: choose cache-first, network-only, or stale-while-revalidate.",
          "retry: retry transient failures with count and delay.",
          "invalidate: mark typed route keys stale after mutations.",
          "optimistic: update cached query data before the server response returns.",
          "onRequest, onResponse, onSuccess, onError, onSettled, and onStatus: observe the full client lifecycle.",
        ],
      },
    ],
  },
  {
    id: "storage",
    href: "/docs/storage",
    section: "Data and APIs",
    title: "Storage",
    description:
      "Use Farm storage clients for key-value data and pass storage clients to framework features and integrations.",
    blocks: [
      {
        title: "Create a storage client",
        code: {
          title: "src/lib/storage.ts",
          language: "ts",
          source: `import { sqliteStorage } from "@farmjs/core/storage";

export const appStorage = sqliteStorage({
  path: "./.farm/storage/app.sqlite",
  tableName: "app_store",
});

await appStorage.setItem("settings", { theme: "light" });`,
        },
      },
      {
        title: "Mount stores",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `import { defineFarmConfig } from "@farmjs/core";
import { redisStorage, sqliteStorage } from "@farmjs/core/storage";

export default defineFarmConfig({
  storage: {
    mounts: {
      app: sqliteStorage({ path: "./.farm/storage/app.sqlite" }),
      ratelimit: redisStorage({ url: process.env.REDIS_URL! }),
    },
  },
});`,
        },
      },
      {
        title: "Supported drivers",
        bullets: [
          "memory, local filesystem, SQLite, libSQL, PGlite, Postgres, MySQL, Redis, Upstash Redis, MongoDB, S3, and Vercel KV.",
        ],
      },
    ],
  },
  {
    id: "integrations",
    href: "/docs/integrations",
    section: "Integrations",
    title: "Integrations",
    description:
      "Register services once, get owned routes, typed callers, providers, middleware, storage access, lifecycle hooks, and validation.",
    blocks: [
      {
        title: "Register integrations",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `import { defineFarmConfig } from "@farmjs/core";
import { stripe } from "@farmjs/integrations/stripe";

export default defineFarmConfig({
  integrations: {
    billing: stripe({
      secretKey: process.env.STRIPE_SECRET_KEY,
      products: [],
    }),
  },
});`,
        },
      },
      {
        title: "Create shared callers",
        code: {
          title: "src/lib/api.ts",
          language: "ts",
          source: `import { createIntegrations } from "@farmjs/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>({
  data: {
    appName: "farm-dashboard",
  },
});`,
        },
      },
      {
        title: "What an integration can contribute",
        bullets: [
          "api: typed client and server callable operations.",
          "routes and endpoints: HTTP handlers with zod or standard-schema input validation.",
          "middleware: request behavior for protected routes, rate limits, webhooks, and redirects.",
          "providers: app wrappers for client SDKs or context providers.",
          "schema: models used by Farm's integration ORM layer.",
          "config, validate, setup, ready, dispose: lifecycle and configuration validation.",
        ],
      },
    ],
  },
  {
    id: "integrations-stripe",
    href: "/docs/integrations/stripe",
    section: "Integrations",
    title: "Stripe Integration",
    description:
      "Add checkout, portal sessions, billing status, webhooks, product catalogs, metering, and storage-backed billing snapshots.",
    blocks: [
      {
        title: "Install from the CLI",
        code: {
          title: "Terminal",
          language: "bash",
          source: `farm add integration stripe --ui`,
        },
      },
      {
        title: "Config-first setup",
        code: {
          title: "src/lib/integrations.ts",
          language: "ts",
          source: `import { stripe } from "@farmjs/integrations/stripe";

export const integrations = {
  billing: stripe({
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    products: [
      {
        id: "pro",
        name: "Pro",
        prices: [{ interval: "month", amount: 2900, currency: "usd" }],
      },
    ],
  }),
};`,
        },
      },
      {
        title: "Usage",
        code: {
          title: "Client checkout",
          language: "ts",
          source: `const checkout = await apiClient.billing.checkout.post({
  body: {
    productId: "pro",
    successUrl: "/success",
    cancelUrl: "/pricing",
  },
});

if (checkout.data?.url) {
  window.location.href = checkout.data.url;
}`,
        },
      },
      {
        title: "Storage-aware billing",
        body: [
          "The Stripe integration can use Farm's integration ORM layer through ctx.args.db, so billing snapshot reads and writes can work across Prisma, Drizzle, SQLite SQL, and other farming-labs/orm compatible clients.",
        ],
      },
    ],
  },
  {
    id: "integrations-auth",
    href: "/docs/integrations/auth",
    section: "Integrations",
    title: "Auth Integrations",
    description:
      "Use Better Auth, Auth.js, Clerk, Auth0, WorkOS, or Supabase without hand-rolling every auth route.",
    blocks: [
      {
        title: "Auth providers",
        cards: [
          {
            title: "Better Auth",
            body: "Owns Better Auth routes and can pair with local SQLite in examples.",
          },
          {
            title: "Auth.js",
            body: "Mounts the /api/auth/[...nextauth] style route internally.",
          },
          {
            title: "Clerk",
            body: "Adds provider wrappers, protected route middleware, and SDK-backed auth.",
          },
          {
            title: "Auth0, WorkOS, Supabase",
            body: "Config-first login, callback, logout, session, and protected route flows.",
          },
        ],
      },
      {
        title: "Supabase example",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `import { supabase } from "@farmjs/integrations/supabase";

export default defineFarmConfig({
  integrations: {
    auth: supabase({
      callbackUrl: "http://localhost:3000/auth/callback",
      protectedRoutes: ["/dashboard(.*)"],
      pages: {
        signIn: "/sign-in",
        signUp: "/sign-up",
      },
    }),
  },
});`,
        },
      },
      {
        title: "Server and client callers",
        code: {
          title: "src/lib/api.ts",
          language: "ts",
          source: `export const { api, apiClient } = createIntegrations<AppIntegrations>();

const sessionOnServer = await api.auth.session.get();
const sessionInBrowser = await apiClient.auth.session.get();`,
        },
      },
    ],
  },
  {
    id: "integrations-email",
    href: "/docs/integrations/email",
    section: "Integrations",
    title: "Email Integration",
    description:
      "Render React Email templates, send with Resend, schedule messages, preview templates, and receive webhooks.",
    blocks: [
      {
        title: "Define templates",
        code: {
          title: "src/lib/email.ts",
          language: "tsx",
          source: `import { resend, template } from "@farmjs/integrations/email";

const templates = {
  welcome: template({
    subject: "Welcome to Farm",
    component: ({ name }: { name: string }) => <p>Hello {name}</p>,
  }),
};

export const email = resend({
  apiKey: process.env.RESEND_API_KEY,
  defaults: { from: "hello@example.com" },
  templates,
});`,
        },
      },
      {
        title: "Send mail",
        code: {
          title: "Caller",
          language: "ts",
          source: `await apiClient.email.send.post({
  body: {
    template: "welcome",
    to: "ada@example.com",
    data: { name: "Ada" },
  },
});`,
        },
      },
    ],
  },
  {
    id: "integrations-jobs",
    href: "/docs/integrations/jobs",
    section: "Integrations",
    title: "Jobs Integration",
    description:
      "Define typed tasks once and run them through Trigger.dev or Inngest with trigger, schedule, batch, status, and cancel APIs.",
    blocks: [
      {
        title: "Define tasks",
        code: {
          title: "src/lib/jobs.ts",
          language: "ts",
          source: `import { defineTasks, task } from "@farmjs/integrations/jobs";

export const tasks = defineTasks({
  sendWelcomeEmail: task({
    id: "send-welcome-email",
    async run(input: { userId: string }, context) {
      context.logger.info("Sending welcome email", input);
      return { ok: true };
    },
  }),
});`,
        },
      },
      {
        title: "Mount a runtime",
        code: {
          title: "src/lib/integrations.ts",
          language: "ts",
          source: `import { jobs, trigger } from "@farmjs/integrations/jobs";
import { tasks } from "./jobs";

export const integrations = {
  jobs: jobs({
    tasks,
    runtime: trigger({
      secretKey: process.env.TRIGGER_SECRET_KEY,
      projectRef: process.env.TRIGGER_PROJECT_REF,
    }),
  }),
};`,
        },
      },
      {
        title: "Trigger work",
        code: {
          title: "Caller",
          language: "ts",
          source: `const queued = await api.jobs.sendWelcomeEmail.trigger({
  body: {
    userId: "usr_123",
    $options: { tags: ["signup"] },
  },
});

await api.jobs.sendWelcomeEmail.status({
  query: { handleId: queued.data!.handleId },
});`,
        },
      },
    ],
  },
  {
    id: "integrations-unkey",
    href: "/docs/integrations/unkey",
    section: "Integrations",
    title: "Unkey Integration",
    description:
      "Create, verify, revoke, update, and delete API keys, plus protect routes with key verification and rate-limit checks.",
    blocks: [
      {
        title: "Configure Unkey",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `import { unkey } from "@farmjs/integrations/unkey";

export default defineFarmConfig({
  integrations: {
    keys: unkey({
      rootKey: process.env.UNKEY_ROOT_KEY,
      apiId: process.env.UNKEY_API_ID,
    }),
  },
});`,
        },
      },
      {
        title: "Create and verify keys",
        code: {
          title: "Caller",
          language: "ts",
          source: `const created = await api.keys.createKey.post({
  body: {
    name: "Production key",
    permissions: ["documents.read"],
  },
});

const verified = await api.keys.verifyKey.post({
  body: {
    key: created.data!.key,
    permissions: "documents.read",
  },
});`,
        },
      },
      {
        title: "Best fit",
        bullets: [
          "API products where customers need their own keys.",
          "Internal platform keys for service-to-service requests.",
          "Route protection where key validity, permissions, credits, or rate limits matter.",
        ],
      },
    ],
  },
  {
    id: "integrations-ui-registry",
    href: "/docs/integrations/ui-registry",
    section: "Integrations",
    title: "UI Registry",
    description:
      "Opt into shadcn-style UI scaffolds for built-in integrations when you want working screens with the integration setup.",
    blocks: [
      {
        title: "Add integration UI",
        body: [
          "Farm's CLI can install integration wiring only, or include UI with --ui. The UI registry is opt-in so teams that already have a design system can keep their app clean.",
        ],
        code: {
          title: "Terminal",
          language: "bash",
          source: `farm add integration stripe --ui
farm add integration better-auth --ui
farm add integration jobs-trigger --ui`,
        },
      },
      {
        title: "Registry principles",
        bullets: [
          "Base components follow shadcn conventions.",
          "Feature registries are grouped by provider, such as billing, auth, jobs, email, AI, and API keys.",
          "Generated files are app-owned, so users can edit the UI after installation.",
        ],
      },
    ],
  },
  {
    id: "integrations-orm-storage",
    href: "/docs/integrations/orm-storage",
    section: "Integrations",
    title: "ORM Storage for Integrations",
    description:
      "Pass one storage client through farm.config.ts and let integrations use ctx.args.db through the unified farming-labs/orm-style API.",
    blocks: [
      {
        title: "Pass a client",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `import { defineFarmConfig } from "@farmjs/core";
import { client } from "./src/lib/db";

export default defineFarmConfig({
  storage: {
    client,
  },
});`,
        },
      },
      {
        title: "Use db in integration hooks",
        code: {
          title: "custom integration",
          language: "ts",
          source: `export const billing = defineIntegration({
  category: "payment",
  type: "custom-billing",
  schema: billingSchema,
  async setup(ctx) {
    const db = await ctx.args.getDb();
    await db.billingAccount.findMany();
  },
});`,
        },
      },
      {
        title: "SQLite shape",
        body: [
          "For SQLite, the app owns the SQLite-compatible client instance and Farm passes it through storage.client. Integrations only depend on ctx.args.db, so the provider can change without rewriting integration code.",
        ],
      },
    ],
  },
  {
    id: "cache-ppr",
    href: "/docs/cache-ppr",
    section: "Runtime",
    title: "Cache and PPR",
    description:
      "Use shared runtime cache helpers, tag/path invalidation, ISR-style revalidation, and static shell caching for PPR pages.",
    blocks: [
      {
        title: "Cache data",
        code: {
          title: "server data",
          language: "ts",
          source: `import { createFarmCacheKey, getFarmDataCache } from "@farmjs/core/cache";

const cache = getFarmDataCache();
const key = createFarmCacheKey(["products", "featured"]);

const products = await cache.getOrSet(
  key,
  () => fetchProducts(),
  {
    tags: ["products"],
    paths: ["/pricing"],
    revalidate: 300,
  },
);`,
        },
      },
      {
        title: "Revalidate",
        code: {
          title: "server action or route handler",
          language: "ts",
          source: `import { revalidatePath, revalidateTag } from "@farmjs/core/cache";

revalidateTag("products");
revalidatePath("/pricing");`,
        },
      },
      {
        title: "PPR shell",
        code: {
          title: "src/app/dashboard/page.tsx",
          language: "tsx",
          source: `export const experimental_ppr = true;
export const revalidate = 60;

export default function DashboardPage() {
  return <main>Static shell with dynamic sections</main>;
}`,
        },
      },
    ],
  },
  {
    id: "observability",
    href: "/docs/observability",
    section: "Runtime",
    title: "Observability",
    description:
      "Listen to Farm runtime events for server lifecycle, route matching, rendering, API routes, integrations, storage, cache, PPR, builds, plugins, and errors.",
    blocks: [
      {
        title: "Subscribe to events",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `import { onFarmEvent } from "@farmjs/core/observability";

onFarmEvent((event) => {
  if (event.level === "error") {
    console.error("[farm]", event.type, event);
  }
});`,
        },
      },
      {
        title: "Event families",
        table: {
          headers: ["Family", "Examples"],
          rows: [
            ["Server", "server.start, server.ready, server.shutdown"],
            ["Routing", "route.discovered, route.matched, route.notFound, route.redirect"],
            ["Rendering", "render.start, render.complete, render.stream.shellReady, render.error"],
            ["Cache", "cache.hit, cache.miss, cache.set, cache.revalidateTag"],
            ["PPR", "ppr.shell.hit, ppr.shell.cached, ppr.shell.invalidated"],
            [
              "Integrations",
              "integration.ready, integration.api.call.start, integration.webhook.verified",
            ],
            ["Storage", "storage.query.start, storage.schema.ready"],
            ["Build", "build.start, routes.generated, types.generated, manifest.generated"],
          ],
        },
      },
    ],
  },
  {
    id: "deployment",
    href: "/docs/deployment",
    section: "Runtime",
    title: "Deployment",
    description:
      "Build deployable output for Vercel, Cloudflare Pages, Netlify, or Node with Farm's deploy config and Nitro presets.",
    blocks: [
      {
        title: "Target-based deploy config",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `export default defineFarmConfig({
  deploy: {
    target: "vercel",
    output: ".vercel/output",
  },
});`,
        },
      },
      {
        title: "Targets",
        table: {
          headers: ["Target", "Preset", "Default output"],
          rows: [
            ["vercel", "vercel", ".vercel/output"],
            ["cloudflare", "cloudflare-pages", ".output"],
            ["netlify", "netlify", ".output"],
            ["node", "node-server", ".output"],
          ],
        },
      },
      {
        title: "Build",
        code: {
          title: "Terminal",
          language: "bash",
          source: `pnpm build
farm build --target vercel
farm deploy --cloudflare`,
        },
      },
    ],
  },
  {
    id: "docs-engine",
    href: "/docs/docs-engine",
    section: "Content",
    title: "Docs Engine",
    description:
      "Serve a @farming-labs/docs-inspired docs runtime from Farm config, including human pages and agent-readable API routes.",
    blocks: [
      {
        title: "Enable docs",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `export default defineFarmConfig({
  docs: {
    entry: "/docs",
  },
});`,
        },
      },
      {
        title: "Automatic docs routes",
        body: [
          "When docs.entry is enabled, Farm can serve the docs entry and /api/docs machine endpoints automatically. Route wrappers are only needed when you want to override the default behavior.",
        ],
        bullets: [
          "/docs",
          "/docs/getting-started",
          "/docs/getting-started.md",
          "/api/docs?format=llms",
          "/api/docs?format=sitemap-xml",
          "/api/docs/agent/spec",
        ],
      },
      {
        title: "Config discovery",
        body: [
          "Farm scans docs.config.ts, docs.config.js, docs.config.mjs, docs.config.cjs, and docs.json by default. Inline config in farm.config.ts can override discovered values.",
        ],
      },
    ],
  },
  {
    id: "markdown",
    href: "/docs/markdown",
    section: "Content",
    title: "Markdown Mirrors",
    description:
      "Expose markdown versions of app pages so agents, crawlers, docs tools, and support workflows can read rendered content as text.",
    blocks: [
      {
        title: "Expose pages",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `export default defineFarmConfig({
  md: {
    expose: ["/", "/pricing", "/docs"],
    cache: 60,
  },
});`,
        },
      },
      {
        title: "Routes",
        table: {
          headers: ["Page", "Markdown mirror"],
          rows: [
            ["/", "/index.md"],
            ["/pricing", "/pricing.md"],
            ["/docs", "/docs.md"],
          ],
        },
      },
      {
        title: "Use cases",
        bullets: [
          "AI assistants can fetch page content without parsing the full app shell.",
          "Pricing, docs, changelog, and policy pages become easy to cite.",
          "Teams can keep one source of truth: the actual rendered page.",
        ],
      },
    ],
  },
  {
    id: "openapi",
    href: "/docs/openapi",
    section: "Content",
    title: "OpenAPI Reference",
    description:
      "Generate and publish API reference docs from Farm API route metadata, with Scalar-style presentation.",
    blocks: [
      {
        title: "Enable OpenAPI",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `export default defineFarmConfig({
  openapi: {
    enabled: true,
    route: "/docs/reference",
    title: "Farm API",
    version: "1.0.0",
  },
});`,
        },
      },
      {
        title: "Reference route",
        body: [
          "The OpenAPI route can be included in generated route types so docs navigation and Link hrefs stay aware of the reference page.",
        ],
      },
    ],
  },
  {
    id: "plugins",
    href: "/docs/plugins",
    section: "Extending",
    title: "Plugin Ecosystem",
    description:
      "Use server plugins to extend config, request handling, routing, rendering, bundling, HMR, and lifecycle hooks.",
    blocks: [
      {
        title: "Use plugins",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `import { createCompressionPlugin, createLoggerPlugin } from "@farmjs/core/plugin/server";

export default defineFarmConfig({
  plugins: [
    createLoggerPlugin({}),
    createCompressionPlugin({}),
  ],
});`,
        },
      },
      {
        title: "Built-in plugins",
        bullets: [
          "Logger for request and lifecycle logging.",
          "Compression for production response encoding.",
          "Redirects, rewrites, and headers from farm.config.ts.",
          "Env helpers for loading and exposing configuration.",
        ],
      },
      {
        title: "Lifecycle surface",
        body: [
          "Plugins can observe config resolution, route discovery, route matching, render start and completion, API handlers, bundle steps, Nitro build, HMR updates, errors, and shutdown.",
        ],
      },
    ],
  },
  {
    id: "create-plugin",
    href: "/docs/plugins/create-plugin",
    section: "Extending",
    title: "Create a Plugin",
    description:
      "Build a plugin with definePlugin when app behavior belongs in reusable framework lifecycle hooks.",
    blocks: [
      {
        title: "Define a plugin",
        code: {
          title: "src/lib/request-id-plugin.ts",
          language: "ts",
          source: `import { definePlugin } from "@farmjs/core";
import { randomUUID } from "node:crypto";

export const requestIdPlugin = definePlugin({
  name: "request-id",
  beforeRequest(req, _res, context) {
    context.requestContext.set(req, "request.id", randomUUID(), {
      exposeToPage: true,
    });
  },
});`,
        },
      },
      {
        title: "Register it",
        code: {
          title: "farm.config.ts",
          language: "ts",
          source: `import { requestIdPlugin } from "./src/lib/request-id-plugin";

export default defineFarmConfig({
  plugins: [requestIdPlugin],
});`,
        },
      },
    ],
  },
  {
    id: "cli",
    href: "/docs/cli",
    section: "Reference",
    title: "CLI",
    description:
      "Use the Farm CLI to run, build, generate types, deploy output, and add integrations.",
    blocks: [
      {
        title: "Common commands",
        table: {
          headers: ["Command", "Purpose"],
          rows: [
            ["farm dev", "Start the dev server."],
            ["farm build", "Build the app for the configured target."],
            ["farm preview", "Preview the production output."],
            ["farm generate", "Generate API and route types."],
            ["farm add integration stripe --ui", "Add integration wiring and optional UI."],
          ],
        },
      },
      {
        title: "Provider names",
        body: [
          "The integration generator supports ai, stripe, supabase, workos, auth0, clerk, better-auth, authjs, autumn, polar, resend, jobs-trigger, jobs-inngest, and unkey.",
        ],
      },
    ],
  },
  {
    id: "examples",
    href: "/docs/examples",
    section: "Reference",
    title: "Examples",
    description:
      "Use the examples folder as executable docs for routing, RSC, docs, markdown, auth, billing, email, jobs, and API keys.",
    blocks: [
      {
        title: "Example apps",
        table: {
          headers: ["Example", "Shows"],
          rows: [
            ["examples/basic", "Core routing, layouts, deployment config, markdown mirrors, PPR."],
            ["examples/ssr-ssg-demo", "SSR, SSG, ISR, API routes, middleware."],
            ["examples/docs-integration", "Docs runtime and /api/docs machine routes."],
            ["examples/stripe-integration", "Stripe checkout, portal, session, webhooks."],
            ["examples/stripe-integrations/*", "Stripe with Prisma, Drizzle, SQLite, org billing."],
            ["examples/better-auth-integration", "Better Auth routes with local SQLite."],
            ["examples/jobs-trigger", "Trigger.dev jobs runtime."],
            ["examples/jobs-inngest", "Inngest jobs runtime."],
          ],
        },
      },
      {
        title: "Run one example",
        code: {
          title: "Terminal",
          language: "bash",
          source: `pnpm --filter @farmjs/core build
pnpm --dir examples/basic install
pnpm --dir examples/basic dev`,
        },
      },
    ],
  },
  {
    id: "reference",
    href: "/docs/reference",
    section: "Reference",
    title: "Reference",
    description: "A compact map of the main package exports and where to learn more.",
    blocks: [
      {
        title: "Core exports",
        table: {
          headers: ["Export area", "What it covers"],
          rows: [
            [
              "@farmjs/core",
              "Config, app types, plugins, integrations, routing, OpenAPI, docs, cache.",
            ],
            ["@farmjs/core/client", "Link, router helpers, API client, integration client."],
            ["@farmjs/core/query", "Query and route param types."],
            ["@farmjs/core/storage", "Storage clients and mount helpers."],
            ["@farmjs/core/cache", "Data cache, revalidation, cache keys."],
            ["@farmjs/integrations", "Auth, billing, email, jobs, AI, API keys, provider clients."],
          ],
        },
      },
      {
        title: "Recommended reading path",
        steps: [
          "Start with Getting Started and Project Structure.",
          "Read Routing, Layouts, and Rendering Model.",
          "Add API Routes, API Client, and Query.",
          "Choose integrations and storage once your product needs them.",
          "Finish with Deployment, Observability, and Reference.",
        ],
      },
    ],
  },
] satisfies readonly DocPage[];

const sectionOrder = [
  {
    title: "Start",
    description: "Create an app and learn the files that matter.",
    pageIds: ["getting-started", "project-structure", "configuration"],
  },
  {
    title: "Core",
    description: "Routes, rendering, layouts, and request flow.",
    pageIds: ["routing", "layouts", "server-rendering", "middleware"],
  },
  {
    title: "Data and APIs",
    description: "Typed params, API routes, API callers, and storage.",
    pageIds: ["query", "api-routes", "api-client", "storage"],
  },
  {
    title: "Integrations",
    description: "Provider integrations and custom integration contracts.",
    pageIds: [
      "integrations",
      "integrations-stripe",
      "integrations-auth",
      "integrations-email",
      "integrations-jobs",
      "integrations-unkey",
      "integrations-ui-registry",
      "integrations-orm-storage",
    ],
  },
  {
    title: "Runtime",
    description: "Cache, PPR, observability, and deployment output.",
    pageIds: ["cache-ppr", "observability", "deployment"],
  },
  {
    title: "Content",
    description: "Docs runtime, markdown mirrors, and OpenAPI.",
    pageIds: ["docs-engine", "markdown", "openapi"],
  },
  {
    title: "Extending",
    description: "Plugin system and lifecycle hooks.",
    pageIds: ["plugins", "create-plugin"],
  },
  {
    title: "Reference",
    description: "CLI, examples, and package map.",
    pageIds: ["cli", "examples", "reference"],
  },
] as const;

const pageById = new Map(docPages.map((page) => [page.id, page]));
const pageByHref = new Map(docPages.map((page) => [page.href, page]));

export const docSections = sectionOrder.map((section) => ({
  title: section.title,
  description: section.description,
  pages: section.pageIds.map((id) => {
    const page = pageById.get(id);
    if (!page) {
      throw new Error(`Missing docs page: ${id}`);
    }
    return page;
  }),
}));

export const featuredDocPages = [
  "getting-started",
  "routing",
  "api-client",
  "integrations",
  "cache-ppr",
  "deployment",
].map((id) => {
  const page = pageById.get(id);
  if (!page) {
    throw new Error(`Missing featured docs page: ${id}`);
  }
  return page;
});

export function getDocPage(href: string): DocPage {
  const page = pageByHref.get(href);
  if (!page) {
    throw new Error(`Missing docs page for href: ${href}`);
  }
  return page;
}

export function findDocPage(href: string): DocPage | undefined {
  return pageByHref.get(href);
}

export function getDocNeighbors(href: string): {
  previous?: DocPage;
  next?: DocPage;
} {
  const index = docPages.findIndex((page) => page.href === href);
  return {
    previous: index > 0 ? docPages[index - 1] : undefined,
    next: index >= 0 && index < docPages.length - 1 ? docPages[index + 1] : undefined,
  };
}
