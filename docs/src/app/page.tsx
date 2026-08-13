import type { Metadata, PageProps } from "@farm.js/core";
import { FARM_VERSION } from "@farm.js/core/version";
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  BookOpen,
  BookOpenText,
  Bot,
  Braces,
  Check,
  CloudCog,
  Code2,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  FileOutput,
  FileText,
  FolderTree,
  GitFork,
  Layers3,
  Lock,
  Menu,
  Network,
  Plug,
  RefreshCw,
  Rocket,
  Route,
  Terminal,
  TriangleAlert,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import auth0IconUrl from "simple-icons/icons/auth0.svg?url";
import betterAuthIconUrl from "simple-icons/icons/betterauth.svg?url";
import clerkIconUrl from "simple-icons/icons/clerk.svg?url";
import cloudflareIconUrl from "simple-icons/icons/cloudflare.svg?url";
import denoIconUrl from "simple-icons/icons/deno.svg?url";
import dockerIconUrl from "simple-icons/icons/docker.svg?url";
import firebaseIconUrl from "simple-icons/icons/firebase.svg?url";
import githubIconUrl from "simple-icons/icons/github.svg?url";
import netlifyIconUrl from "simple-icons/icons/netlify.svg?url";
import nodeIconUrl from "simple-icons/icons/nodedotjs.svg?url";
import prismaIconUrl from "simple-icons/icons/prisma.svg?url";
import reactIconUrl from "simple-icons/icons/react.svg?url";
import renderIconUrl from "simple-icons/icons/render.svg?url";
import resendIconUrl from "simple-icons/icons/resend.svg?url";
import shadcnIconUrl from "simple-icons/icons/shadcnui.svg?url";
import stripeIconUrl from "simple-icons/icons/stripe.svg?url";
import supabaseIconUrl from "simple-icons/icons/supabase.svg?url";
import vercelIconUrl from "simple-icons/icons/vercel.svg?url";
import viteIconUrl from "simple-icons/icons/vite.svg?url";
import authJsIconUrl from "../assets/brands/authjs.svg?url";
import autumnIconUrl from "../assets/brands/autumn.svg?url";
import eveIconUrl from "../assets/brands/eve.svg?url";
import inngestIconUrl from "../assets/brands/inngest.svg?url";
import polarIconUrl from "../assets/brands/polar.svg?url";
import triggerIconUrl from "../assets/brands/trigger.svg?url";
import unkeyIconUrl from "../assets/brands/unkey.svg?url";
import workosIconUrl from "../assets/brands/workos.svg?url";
import farmingLabsLogoUrl from "../assets/farming-labs-logo-dark.svg?url";
import nitroIconUrl from "../assets/nitro.svg?url";
import { BenchmarkSection } from "../components/home/benchmark-section";
import { HeroTitleFrame } from "../components/home/hero-title-frame";
import { HighlightedCode, HighlightedCodeTabs } from "../components/home/highlighted-code";
import type { HighlightedCodeTab } from "../components/home/highlighted-code";
import { InstallCommand } from "../components/home/install-command";
import { FileTree } from "../components/ui/file-tree";
import type { FileTreeNode } from "../components/ui/file-tree";
import { FlickeringGrid } from "../components/ui/flickering-grid";
import { farmBenchmark, formatBenchmarkDuration } from "../lib/framework-benchmark";

const homepageTitle = "Farm.js - Framework for modern integrated apps";
const homepageDescription =
  "Farm.js is the framework for modern integrated apps, unifying routing, typed APIs, middleware, integrations, docs, and deployment.";

export const metadata = {
  metadataBase: "https://farmjs.dev",
  title: homepageTitle,
  description: homepageDescription,
  openGraph: {
    title: homepageTitle,
    description: homepageDescription,
    url: "https://farmjs.dev/",
    siteName: "Farm.js",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: homepageTitle,
    description: homepageDescription,
    images: ["/opengraph-image"],
  },
} satisfies Metadata;

const navItems = [
  { index: "01", label: "Guide", href: "/docs/getting-started", icon: BookOpen },
  { index: "02", label: "Migrations", href: "/docs/migrations", icon: GitFork },
  { index: "03", label: "Integrations", href: "/docs/integrations", icon: Blocks },
  { index: "04", label: "Resources", href: "/docs", icon: FileText },
] as const;

type ProductStackItem = {
  label: string;
  href: string;
  brand?: string;
  icon?: LucideIcon;
  wordmark?: boolean;
};

function withFarmReferral(href: string) {
  const url = new URL(href);
  url.searchParams.set("utm_source", "farmjs.dev");
  url.searchParams.set("utm_medium", "referral");
  url.searchParams.set("utm_campaign", "product_stack");
  return url.toString();
}

const integrationDirectoryItems = [
  {
    row: 0,
    col: 0,
    label: "Farm Auth",
    href: "/docs/auth",
    icon: Lock,
  },
  {
    row: 0,
    col: 1,
    label: "Better Auth",
    href: "/docs/integrations/auth/better-auth",
    brand: betterAuthIconUrl,
  },
  {
    row: 0,
    col: 3,
    label: "Auth.js",
    href: "/docs/integrations/auth/authjs",
    brand: authJsIconUrl,
  },
  {
    row: 1,
    col: 0,
    label: "Clerk",
    href: "/docs/integrations/auth/clerk",
    brand: clerkIconUrl,
  },
  {
    row: 1,
    col: 2,
    label: "Auth0",
    href: "/docs/integrations/auth/auth0",
    brand: auth0IconUrl,
  },
  {
    row: 1,
    col: 4,
    label: "WorkOS",
    href: "/docs/integrations/auth/workos",
    brand: workosIconUrl,
  },
  {
    row: 2,
    col: 1,
    label: "Supabase",
    href: "/docs/integrations/auth/supabase",
    brand: supabaseIconUrl,
  },
  {
    row: 2,
    col: 3,
    label: "Autumn",
    href: "/docs/integrations/autumn",
    brand: autumnIconUrl,
  },
  {
    row: 3,
    col: 0,
    label: "Polar",
    href: "/docs/integrations/polar",
    brand: polarIconUrl,
  },
  {
    row: 3,
    col: 2,
    label: "Stripe",
    href: "/docs/integrations/stripe",
    brand: stripeIconUrl,
  },
  {
    row: 3,
    col: 4,
    label: "Resend",
    href: "/docs/integrations/email",
    brand: resendIconUrl,
  },
  {
    row: 4,
    col: 1,
    label: "Prisma",
    href: "/docs/integrations/orm-storage",
    brand: prismaIconUrl,
  },
  {
    row: 4,
    col: 3,
    label: "Inngest",
    href: "/docs/integrations/inngest",
    brand: inngestIconUrl,
  },
  {
    row: 5,
    col: 0,
    label: "Trigger.dev",
    href: "/docs/integrations/trigger",
    brand: triggerIconUrl,
  },
  {
    row: 5,
    col: 2,
    label: "shadcn/ui",
    href: "/docs/integrations/ui-registry",
    brand: shadcnIconUrl,
  },
  {
    row: 5,
    col: 4,
    label: "Unkey",
    href: "/docs/integrations/unkey",
    brand: unkeyIconUrl,
  },
] as const;

const ecosystemItems = [
  { label: "React 19", href: withFarmReferral("https://react.dev/"), brand: reactIconUrl },
  { label: "Stripe", href: withFarmReferral("https://stripe.com/"), brand: stripeIconUrl },
  {
    label: "Cloudflare",
    href: withFarmReferral("https://developers.cloudflare.com/agents/"),
    brand: cloudflareIconUrl,
  },
  {
    label: "Better Auth",
    href: withFarmReferral("https://better-auth.com/"),
    brand: betterAuthIconUrl,
  },
  { label: "Vercel", href: withFarmReferral("https://vercel.com/"), brand: vercelIconUrl },
  { label: "Inngest", href: withFarmReferral("https://www.inngest.com/"), brand: inngestIconUrl },
  { label: "Vite", href: withFarmReferral("https://vite.dev/"), brand: viteIconUrl },
  { label: "Supabase", href: withFarmReferral("https://supabase.com/"), brand: supabaseIconUrl },
  {
    label: "Trigger.dev",
    href: withFarmReferral("https://trigger.dev/"),
    brand: triggerIconUrl,
  },
  { label: "Docker", href: withFarmReferral("https://www.docker.com/"), brand: dockerIconUrl },
  { label: "Clerk", href: withFarmReferral("https://clerk.com/"), brand: clerkIconUrl },
  { label: "Resend", href: withFarmReferral("https://resend.com/"), brand: resendIconUrl },
  { label: "Nitro", href: withFarmReferral("https://nitro.build/"), brand: nitroIconUrl },
  { label: "Polar", href: withFarmReferral("https://polar.sh/"), brand: polarIconUrl },
  { label: "Netlify", href: withFarmReferral("https://www.netlify.com/"), brand: netlifyIconUrl },
  { label: "Auth.js", href: withFarmReferral("https://authjs.dev/"), brand: authJsIconUrl },
  { label: "Autumn", href: withFarmReferral("https://useautumn.com/"), brand: autumnIconUrl },
  {
    label: "Cloudflare",
    href: withFarmReferral("https://www.cloudflare.com/"),
    brand: cloudflareIconUrl,
  },
  { label: "Prisma", href: withFarmReferral("https://www.prisma.io/"), brand: prismaIconUrl },
  { label: "Auth0", href: withFarmReferral("https://auth0.com/"), brand: auth0IconUrl },
  {
    label: "shadcn/ui",
    href: withFarmReferral("https://ui.shadcn.com/"),
    brand: shadcnIconUrl,
  },
  { label: "WorkOS", href: withFarmReferral("https://workos.com/"), brand: workosIconUrl },
  { label: "Unkey", href: withFarmReferral("https://www.unkey.com/"), brand: unkeyIconUrl },
  {
    label: "eve",
    href: withFarmReferral("https://www.eve.dev/"),
    brand: eveIconUrl,
    wordmark: true,
  },
] satisfies readonly ProductStackItem[];

type DeploymentTile = {
  row: number;
  col: number;
  label?: string;
  brand?: string;
};

const deploymentTiles: readonly DeploymentTile[] = [
  { row: 0, col: 1 },
  { row: 0, col: 3, label: "Vercel", brand: vercelIconUrl },
  { row: 1, col: 0 },
  { row: 1, col: 2, label: "Cloudflare", brand: cloudflareIconUrl },
  { row: 1, col: 4, label: "Firebase", brand: firebaseIconUrl },
  { row: 2, col: 1, label: "Netlify", brand: netlifyIconUrl },
  { row: 2, col: 3, label: "Docker", brand: dockerIconUrl },
  { row: 3, col: 0 },
  { row: 3, col: 2, label: "Nitro presets", brand: nitroIconUrl },
  { row: 3, col: 4, label: "Render", brand: renderIconUrl },
  { row: 4, col: 1, label: "Self-host", brand: nodeIconUrl },
  { row: 4, col: 3, label: "Deno", brand: denoIconUrl },
];

const footerGroups = [
  {
    title: "Framework",
    icon: BookOpen,
    brand: null,
    action: ["Read guide", "/docs/getting-started"],
    links: [
      ["Getting started", "/docs/getting-started"],
      ["Routing", "/docs/routing"],
      ["Middleware", "/docs/middleware"],
    ],
  },
  {
    title: "Product",
    icon: Layers3,
    brand: null,
    action: ["Integrations", "/docs/integrations"],
    links: [
      ["Integrations", "/docs/integrations"],
      ["API client", "/docs/api-client"],
      ["Deployment", "/docs/deployment"],
    ],
  },
  {
    title: "Open source",
    icon: GitFork,
    brand: githubIconUrl,
    action: ["View source", "https://github.com/farming-labs/farm.js"],
    links: [["GitHub", "https://github.com/farming-labs/farm.js"]],
  },
] as const;

const typedApiCode = `const { data, error } = await api.users.get({
  query: { limit: "5" },
});

if (error) throw error;

data?.users[0]?.name;
//   ^? string | undefined`;

const integrationCodeTabs = [
  {
    id: "integrations",
    label: "integrations.ts",
    language: "ts",
    highlightLines: [1, 5, 7],
    code: `import Stripe from "stripe";
import { stripe } from "@farm.js/integrations/stripe";
import { unkey } from "@farm.js/integrations/unkey";

const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);
export const integrations = {
    billing: stripe({ instance: stripeClient }),
    keys: unkey({
        rootKey: process.env.UNKEY_ROOT_KEY,
        apiId: process.env.UNKEY_API_ID,
    }),
};`,
  },
  {
    id: "apis",
    label: "Typed integration calls",
    language: "ts",
    highlightLines: [3, 4, 7, 8],
    code: `import { api, apiClient } from "@/lib/api";

const key = await api.keys.create.post({
    body: { name: "Production key" },
});

const checkout = await apiClient.billing.checkout.post({
    body: { productId: "pro" },
});`,
  },
] as const satisfies readonly [HighlightedCodeTab, ...HighlightedCodeTab[]];

const docsConfigCode = `import { defineConfig } from "@farm.js/core";
export default defineConfig({
    docs: {
        enabled: true,
        entry: "/docs",
        search: true,
        mcp: true,
    },
});`;

const typedApiHighlightLines = [1, 7, 8] as const;
const docsHighlightLines = [3, 4] as const;
const rendererOptions = ["preact()", "solid()", "vue()", "svelte()"] as const;

const layersConfigTabs = [
  {
    id: "share",
    label: "Share / layer/farm.config.ts",
    language: "ts",
    code: `import { defineConfig } from "@farm.js/core";
export default defineConfig({
    routeRules: {
        "/products/**": { swr: 300 },
    },
});`,
  },
  {
    id: "consume",
    label: "Consume / app/farm.config.ts",
    language: "ts",
    highlightLines: [5],
    code: `import { defineConfig } from "@farm.js/core";
export default defineConfig({
    extends: [
        "@company/farm-base",
        "./layers/commerce",
    ],
});`,
  },
] as const satisfies readonly [HighlightedCodeTab, ...HighlightedCodeTab[]];

const storageCodeTabs = [
  {
    id: "configure",
    label: "Configure / farm.config.ts",
    language: "ts",
    highlightLines: [4, 5],
    code: `export default defineConfig({
    storage: {
        mounts: {
            app: sqliteStorage({ path: "./data.sqlite" }),
            cache: redisStorage({ url: process.env.REDIS_URL! }),
        },
    },
});`,
  },
  {
    id: "use",
    label: "Use / preferences.ts",
    language: "ts",
    highlightLines: [1, 3, 7],
    code: `const app = getStorage("app");

await app.setItem("settings:1", {
    theme: "dark",
});

const settings = await app.getItem<Settings>("settings:1");`,
  },
] as const satisfies readonly [HighlightedCodeTab, ...HighlightedCodeTab[]];

const createRouteHelper = ["create", "Route"].join("");

const routeCodeTabs = [
  {
    id: "route",
    label: "Route / src/farm.route.ts",
    language: "ts",
    highlightLines: [4, 5, 6, 8, 9],
    code: `export const ProductRoute = ${createRouteHelper}("/products/[id]", {
    params: ProductParams,
    data: {
        before: () => auth.user({ required: true }),
        main: ({ params, before }) => getProduct(params.id, before.id),
        after: ({ data }) => recordView(data.id),
    },
    pending: ProductSkeleton,
    error: ProductError,
    component: ProductPage,
});`,
  },
  {
    id: "component",
    label: "Use / product-page.tsx",
    language: "tsx",
    highlightLines: [2, 6, 7],
    code: `export function ProductPage({
    data,
}: ProductPageProps) {
    return (
        <main>
            <h1>{data.name}</h1>
            <p>{data.description}</p>
        </main>
    );
}`,
  },
] as const satisfies readonly [HighlightedCodeTab, ...HighlightedCodeTab[]];

const agentRuntimeCodeTabs = [
  {
    id: "eve",
    label: "Eve / farm.config.ts",
    language: "ts",
    highlightLines: [5, 8],
    code: `import { eve } from "@farm.js/eve";

export default defineConfig({
    integrations: {
        agent: eve(),
    },
    deploy: {
        target: "vercel",
    },
});`,
  },
  {
    id: "cloudflare",
    label: "Cloudflare / farm.config.ts",
    language: "ts",
    highlightLines: [5, 8, 9],
    code: `import { cfAgent } from "@farm.js/cf-agent";

export default defineConfig({
    integrations: {
        agent: cfAgent(),
    },
    deploy: {
        target: "cloudflare",
        preset: "cloudflare-module",
    },
});`,
  },
] as const satisfies readonly [HighlightedCodeTab, ...HighlightedCodeTab[]];

const agentClientCodeTabs = [
  {
    id: "eve",
    label: "Eve / chat.ts",
    language: "ts",
    highlightLines: [2, 5, 7, 8],
    code: `"use client";
import { useEveAgent } from "eve/react";

export function useChat() {
    const agent = useEveAgent();
    return {
        messages: agent.data.messages,
        send: agent.send,
    };
}`,
  },
  {
    id: "cloudflare",
    label: "Cloudflare / counter.ts",
    language: "ts",
    highlightLines: [2, 5, 6, 7],
    code: `"use client";
import { useAgent } from "agents/react";

export function useCounter() {
    return useAgent<
        CounterAgent,
        CounterState
    >({
        agent: "CounterAgent",
        name: "shared",
    });
}`,
  },
] as const satisfies readonly [HighlightedCodeTab, ...HighlightedCodeTab[]];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function BrandIcon({ src, className }: { src: string; className?: string }) {
  return <img alt="" aria-hidden className={cx("brightness-0 invert", className)} src={src} />;
}

function GithubIcon({ className }: { className?: string }) {
  return <BrandIcon className={className} src={githubIconUrl} />;
}

function IndexedLabel({
  index,
  icon: Icon,
  label,
}: {
  index: string;
  icon?: LucideIcon;
  label: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-normal uppercase tracking-normal text-current">
      <span className="text-white/26">{index}</span>
      <span aria-hidden className="text-white/18">
        /
      </span>
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

function Wordmark({ className }: { className?: string }) {
  return (
    <a
      aria-label="Farm.js home"
      className={cx(
        "shrink-0 font-mono font-normal uppercase tracking-normal text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
        className,
      )}
      href="/"
    >
      FARM<span className="text-white/52">.JS</span>
    </a>
  );
}

function FarmingLabsBrand() {
  return (
    <a
      aria-label="Farming Labs brand assets"
      className="flex shrink-0 items-center text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
      href="https://www.farming-labs.dev/brand"
      title="Farming Labs brand"
    >
      <img alt="" aria-hidden className="h-[19px] w-auto" src={farmingLabsLogoUrl} />
    </a>
  );
}

function BrandLockup() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <FarmingLabsBrand />
      <Wordmark className="text-[11px]" />
    </div>
  );
}

function ButtonLink({
  href,
  children,
  icon,
  size = "default",
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  icon?: ReactNode;
  size?: "default" | "compact";
  variant?: "primary" | "secondary";
}) {
  const isExternal = href.startsWith("http");

  return (
    <a
      className={cx(
        "inline-flex min-w-0 items-center justify-center border font-mono font-normal uppercase tracking-normal transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        size === "default" && "h-11 gap-2 px-5 text-[11px]",
        size === "compact" && "h-9 gap-1.5 px-4 text-[10px]",
        variant === "primary" && "border-white bg-white text-black hover:bg-white/88",
        variant === "secondary" &&
          "border-white/18 bg-black text-white hover:border-white/42 hover:bg-white/[0.06]",
      )}
      href={href}
    >
      {icon ? (
        <span
          aria-hidden
          className={cx(
            "grid shrink-0 place-items-center",
            size === "compact" ? "size-3.5" : "size-4",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
      {isExternal ? (
        <ExternalLink
          aria-hidden
          className={size === "compact" ? "size-3" : "size-3.5"}
          strokeWidth={1.5}
        />
      ) : (
        <ArrowRight
          aria-hidden
          className={size === "compact" ? "size-3" : "size-3.5"}
          strokeWidth={1.5}
        />
      )}
    </a>
  );
}

function AnnouncementBar() {
  return (
    <a
      aria-label={`Farm.js ${FARM_VERSION} is open source and in beta. View on GitHub.`}
      className="farm-announcement flex h-5 items-center justify-center gap-2 border-b border-white/12 px-4 font-mono text-[10px] font-normal uppercase tracking-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
      href="https://github.com/farming-labs/farm.js"
    >
      <GithubIcon className="size-3 opacity-55" />
      <span className="text-white/52">Open source</span>
      <span aria-hidden className="text-white/24">
        /
      </span>
      <span className="text-white/76">Farm.js {FARM_VERSION}</span>
    </a>
  );
}

function Header() {
  return (
    <header className="farm-full-rule sticky top-0 z-50 bg-black/94 backdrop-blur-xl">
      <div className="flex h-11 w-full items-stretch">
        <div className="flex shrink-0 items-center px-4 sm:px-7">
          <BrandLockup />
        </div>

        <nav
          aria-label="Primary navigation"
          className="hidden min-w-0 flex-1 items-stretch border-l border-white/12 lg:flex"
        >
          {navItems.map((item) => (
            <a
              key={item.label}
              className="flex h-full min-w-0 flex-1 items-center border-r border-white/12 px-3 font-mono uppercase tracking-normal text-white/48 transition-colors duration-150 hover:bg-white/[0.035] hover:text-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white xl:px-5"
              href={item.href}
            >
              <IndexedLabel index={item.index} icon={item.icon} label={item.label} />
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden shrink-0 items-stretch lg:flex">
          <a
            aria-label="Open Farm.js on GitHub"
            className="grid size-11 place-items-center border-l border-white/12 text-white/52 transition-colors duration-150 hover:bg-white/[0.035] hover:text-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
            href="https://github.com/farming-labs/farm.js"
            title="GitHub"
          >
            <GithubIcon className="size-4" />
          </a>
          <a
            className="inline-flex h-11 items-center gap-1.5 border-l border-white/12 bg-white px-5 font-mono text-[10px] font-normal uppercase tracking-normal text-black transition-colors duration-150 hover:bg-white/88 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
            href="/docs"
          >
            <BookOpenText aria-hidden className="size-3.5" strokeWidth={1.6} />
            Docs
          </a>
        </div>

        <details className="group relative ml-auto border-l border-white/12 lg:hidden">
          <summary className="grid size-11 cursor-pointer list-none place-items-center text-white transition-colors hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
            <span className="sr-only">Open navigation</span>
            <Menu aria-hidden className="size-4 group-open:hidden" strokeWidth={1.5} />
            <X aria-hidden className="hidden size-4 group-open:block" strokeWidth={1.5} />
          </summary>
          <nav
            aria-label="Mobile navigation"
            className="absolute -right-px top-11 w-screen overflow-hidden border border-white/14 bg-black shadow-2xl shadow-black/60"
          >
            {[...navItems, { index: "05", label: "Docs", href: "/docs", icon: BookOpenText }].map(
              (item) => (
                <a
                  key={item.label}
                  className="flex h-12 items-center border-b border-white/10 px-4 font-mono uppercase tracking-normal text-white/58 last:border-b-0 hover:bg-white/[0.04] hover:text-white"
                  href={item.href}
                >
                  <IndexedLabel index={item.index} icon={item.icon} label={item.label} />
                </a>
              ),
            )}
          </nav>
        </details>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="farm-full-rule farm-hero-rule relative w-full overflow-hidden">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-px -top-px z-30 size-[9px] border-l border-t border-white/28"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-px -right-px z-30 size-[9px] border-b border-r border-white/28"
      />
      <div className="relative z-10 mx-auto flex w-full max-w-[58rem] flex-col items-center px-6 pb-16 pt-11 text-center sm:px-10 sm:pb-20 sm:pt-12 lg:px-12">
        <div className="text-white/42">
          <IndexedLabel index="00" label="Build / Ship / Scale" />
        </div>
        <HeroTitleFrame>
          <h1 className="max-w-full text-[1.125rem] font-medium leading-[1.02] tracking-normal text-white min-[360px]:text-[1.3125rem] min-[380px]:text-[1.4375rem] min-[400px]:text-[1.5rem] min-[420px]:text-[1.625rem] sm:text-[2.25rem] md:text-[2.625rem] lg:text-[3.25rem]">
            <span className="block">a framework for</span>
            <span className="block whitespace-nowrap">product-integrated apps</span>
          </h1>
        </HeroTitleFrame>
        <p className="mt-5 max-w-[38rem] text-balance text-sm leading-6 text-white/56 sm:text-[15px] sm:leading-6">
          Bring the stack you already use. Farm.js connects your app router, typed APIs, middleware,
          integrations, docs, and deployment so they work together as one product.
        </p>
        <div className="mt-6 flex justify-center">
          <ButtonLink
            href="/docs/getting-started"
            icon={<BookOpen aria-hidden className="size-3.5" strokeWidth={1.5} />}
            size="compact"
          >
            Get Started
          </ButtonLink>
        </div>
        <div className="mt-6 w-[calc(100%-3rem)] max-w-[34rem] text-left">
          <InstallCommand />
        </div>
      </div>

      <div
        aria-hidden
        className="farm-hero-flicker pointer-events-none absolute inset-x-0 -bottom-px h-80 sm:h-96"
      >
        <FlickeringGrid
          className="absolute inset-0"
          color="rgb(255, 255, 255)"
          flickerChance={0.9}
          gridGap={7}
          maxOpacity={0.36}
          squareSize={2}
        />
      </div>
    </section>
  );
}

function ProductStackTile({
  item,
  itemIndex,
  duplicate,
}: {
  item: ProductStackItem;
  itemIndex: number;
  duplicate: boolean;
}) {
  const Icon = item.icon;
  const className = cx(
    "flex h-16 w-40 shrink-0 items-center justify-center gap-3 border-r border-white/12 bg-black px-4 font-mono text-[10px] font-normal uppercase tracking-normal text-white/48 transition-colors duration-150 hover:bg-white/[0.07] hover:text-white/82 focus-visible:z-10 focus-visible:bg-white/[0.07] focus-visible:text-white focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-white/36 sm:w-44 sm:text-[11px]",
    itemIndex % 2 === 0 && "bg-white/[0.045]",
  );

  return (
    <a
      aria-label={`${item.label} website (opens in a new tab)`}
      aria-hidden={duplicate ? true : undefined}
      className={className}
      href={item.href}
      rel="noreferrer"
      tabIndex={duplicate ? -1 : undefined}
      target="_blank"
    >
      {item.brand ? (
        <BrandIcon
          className={cx("shrink-0 opacity-72", item.wordmark ? "h-[11px] w-[35px]" : "size-[18px]")}
          src={item.brand}
        />
      ) : Icon ? (
        <Icon aria-hidden className="size-[18px] shrink-0 opacity-72" strokeWidth={1.5} />
      ) : null}
      {item.wordmark ? null : <span className="whitespace-nowrap">{item.label}</span>}
    </a>
  );
}

function EcosystemStrip() {
  return (
    <section className="farm-full-rule w-full">
      <div className="grid h-16 grid-cols-[11rem_minmax(0,1fr)] sm:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center border-r border-white/12 px-4 text-white/36 sm:px-8">
          <IndexedLabel icon={Layers3} index="01" label="Product stack" />
        </div>
        <div
          aria-label="Supported product integrations and deployment targets. Hover or focus an item to pause animation."
          className="farm-logo-viewport min-w-0 overflow-hidden focus-within:outline focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-white/28"
          role="region"
        >
          <div
            className="farm-logo-rail flex h-full w-max"
            style={{ "--farm-logo-duration": `${ecosystemItems.length * 4}s` } as CSSProperties}
          >
            {([0, 1] as const).map((copyIndex) => (
              <div
                key={copyIndex}
                aria-hidden={copyIndex === 1 ? true : undefined}
                className="farm-logo-rail-copy flex h-full shrink-0"
              >
                {ecosystemItems.map((item, itemIndex) => (
                  <ProductStackTile
                    key={`${copyIndex}-${itemIndex}-${item.label}`}
                    duplicate={copyIndex === 1}
                    item={item}
                    itemIndex={itemIndex}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TerminalRequestLine({
  type,
  method,
  path,
  duration,
}: {
  type: "PAGE" | "API";
  method: "GET" | "POST";
  path: string;
  duration: number;
}) {
  const isApi = type === "API";

  return (
    <span className="block whitespace-nowrap text-white/54">
      <span className="text-white/28">[</span>
      <span className="text-white/86">FARM</span>
      <span className="text-white/28">]</span> <span className="text-white/28">[</span>
      <span className={isApi ? "text-white/86" : "text-white/62"}>{type}</span>
      <span className="text-white/28">]</span> <span className="text-white/28">[</span>
      <span className="text-white/72">{method}</span>
      <span className="text-white/28">]</span>{" "}
      <span className={isApi ? "text-white/72" : "text-white/66"}>{path}</span>{" "}
      <span className="text-white/24">-</span> <span className="text-white/84">200</span>{" "}
      <span className={isApi ? "text-white/38" : "text-white/34"}>({duration}ms)</span>
    </span>
  );
}

function TerminalVisual() {
  return (
    <div className="farm-feature-spotlight relative flex h-[340px] items-end justify-end overflow-hidden pl-6 sm:pl-10">
      <figure className="relative z-10 -mb-px -mr-px flex h-[290px] w-full max-w-full shrink-0 flex-col overflow-hidden border border-white/10 bg-black shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
        <figcaption className="flex h-10 items-center justify-between border-b border-white/8 px-4">
          <div className="flex gap-1.5">
            <span className="size-2 rounded-full bg-white/22" />
            <span className="size-2 rounded-full bg-white/14" />
            <span className="size-2 rounded-full bg-white/10" />
          </div>
          <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-normal text-white/28">
            <Terminal aria-hidden className="size-3" strokeWidth={1.5} /> pnpm dev
          </span>
        </figcaption>
        <pre className="min-h-0 flex-1 overflow-x-auto p-5 font-mono text-[10px] leading-5 tracking-normal sm:text-[11px] sm:leading-6">
          <code className="block min-w-0 whitespace-pre-wrap break-words">
            <span className="block min-w-max">
              <span className="block h-5 whitespace-nowrap text-white/48 sm:h-6">
                <span>$ </span>
                <span className="farm-terminal-command-text inline-block align-bottom">
                  pnpm dev
                </span>
                <span aria-hidden className="farm-terminal-command-cursor inline-block" />
              </span>
              <span className="farm-terminal-output mt-1.5 block space-y-1.5">
                <span className="block whitespace-nowrap">
                  <span className="font-semibold text-green-400">Farm.js</span>{" "}
                  <span className="text-white/34">v{FARM_VERSION}</span>{" "}
                  <span className="text-white/34">ready in 23ms</span>
                </span>
                <span className="block whitespace-nowrap text-white/58">
                  <span className="inline-block w-[4.5rem] text-white/82">➜ Local:</span>
                  http://localhost:3000/
                </span>
                <span className="!mt-0.5 block whitespace-nowrap text-white/48">
                  <span className="inline-block w-[4.5rem] text-white/68">➜ Network:</span>
                  http://192.168.1.24:3000/
                </span>
                <TerminalRequestLine duration={8} method="GET" path="/contact" type="PAGE" />
                <TerminalRequestLine duration={5} method="POST" path="/api/waitlist" type="API" />
                <TerminalRequestLine duration={11} method="GET" path="/docs" type="PAGE" />
              </span>
            </span>
          </code>
        </pre>
      </figure>
    </div>
  );
}

function TypedApiVisual() {
  return (
    <div className="farm-feature-spotlight relative flex h-[340px] min-w-0 items-end justify-end overflow-hidden pl-6 sm:pl-10">
      <HighlightedCode
        className="relative z-10 -mb-px -mr-px flex h-[290px] w-full max-w-full shrink-0 flex-col"
        code={typedApiCode}
        highlightLines={typedApiHighlightLines}
        label="/api/users"
        language="tsx"
        prefix="GET"
      />
    </div>
  );
}

function IntegrationVisual() {
  return (
    <div className="farm-feature-spotlight relative flex h-[340px] min-w-0 items-end justify-end overflow-hidden pl-6 sm:pl-10">
      <HighlightedCodeTabs
        className="relative z-10 -mb-px -mr-px flex h-[290px] w-full max-w-full shrink-0 flex-col"
        compact
        id="product-integration-examples"
        tabs={integrationCodeTabs}
        tabsLabel="Integration files"
      />
    </div>
  );
}

function BuildVisual() {
  return (
    <div className="farm-feature-spotlight relative flex h-[340px] items-end justify-end overflow-hidden pl-6 sm:pl-10">
      <figure className="relative z-10 -mb-px -mr-px flex h-[290px] w-full max-w-full shrink-0 flex-col overflow-hidden border border-white/10 bg-black shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
        <figcaption className="flex h-10 items-center justify-between border-b border-white/8 px-4 font-mono text-[9px] tracking-normal text-white/34">
          <span className="flex items-center gap-1.5">
            <Terminal aria-hidden className="size-3" strokeWidth={1.5} /> production build
          </span>
          <span>bash</span>
        </figcaption>
        <pre className="min-h-0 flex-1 overflow-x-auto p-5 font-mono text-[10px] leading-5 tracking-normal text-white/58 sm:text-[11px] sm:leading-6">
          <code className="block min-w-0 whitespace-pre-wrap break-words">
            <span className="block h-5 whitespace-nowrap text-white sm:h-6">
              <span>$ </span>
              <span className="farm-build-command-text inline-block align-bottom">
                farm build --preset node-server
              </span>
              <span aria-hidden className="farm-build-command-cursor inline-block" />
            </span>
            <span className="farm-build-output mt-2 block">
              <span className="block whitespace-nowrap">
                <span className="text-white">[info]</span> 🚜 Building Farm.js application with
                preset: node-server...
              </span>
              <span className="block whitespace-nowrap">
                <span className="text-white">[info]</span> 🔍 Discovering routes and API
                endpoints...
              </span>
              <span className="block whitespace-nowrap">
                <span className="text-white">[info]</span> 📦 Building client and SSR bundles in
                parallel...
              </span>
              <span className="block whitespace-nowrap">
                <span className="text-white">[bench]</span> Fixture build wall time{" "}
                <span className="font-semibold text-white">
                  {formatBenchmarkDuration(farmBenchmark.metrics.buildMs.median)}
                </span>{" "}
                <span className="text-white/34">median</span>
              </span>
              <span className="block whitespace-nowrap text-white/78">
                <span className="text-white">[info]</span> 📁 Output directory: .farm/.output
              </span>
            </span>
          </code>
        </pre>
      </figure>
    </div>
  );
}

function RendererVisual() {
  return (
    <div className="farm-feature-spotlight relative flex h-[340px] min-w-0 items-end justify-end overflow-hidden pl-6 sm:pl-10">
      <figure className="farm-renderer-code-card relative z-10 -mb-px -mr-px flex h-[290px] w-full max-w-full shrink-0 flex-col overflow-hidden border border-white/10 bg-black shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
        <figcaption className="flex h-10 min-w-0 shrink-0 items-center justify-between gap-4 border-b border-white/8 px-4 font-mono text-[9px] tracking-normal text-white/38">
          <span className="flex min-w-0 items-center gap-2">
            <Code2 aria-hidden className="size-3 shrink-0" strokeWidth={1.5} />
            <span className="truncate">farm.config.ts</span>
          </span>
          <span className="shrink-0 uppercase text-white/24">ts</span>
        </figcaption>

        <pre
          aria-label="farm.config.ts with the renderer set to Preact, Solid, Vue, or Svelte. React remains the default."
          className="min-h-0 max-w-full flex-1 overflow-x-auto py-5 font-mono text-[10.5px] leading-6 tracking-normal sm:text-[11px]"
          tabIndex={0}
        >
          <code aria-hidden className="farm-highlighted-code block min-w-full">
            <span className="sh__line">
              <span className="text-white">import</span>
              <span className="text-white/64"> {`{ defineConfig }`} </span>
              <span className="text-white">from</span>
              <span className="text-white/94"> &quot;@farm.js/core&quot;</span>
              <span className="text-white/42">;</span>
            </span>
            <span className="sh__line">&nbsp;</span>
            <span className="sh__line">
              <span className="text-white">export default</span>
              <span className="text-white/64"> defineConfig</span>
              <span className="text-white/42">({`{`}</span>
            </span>
            <span className="sh__line sh__line--highlighted">
              {"  "}
              <span className="text-white/78">renderer</span>
              <span className="text-white/42">: </span>
              <span className="farm-renderer-value" data-renderer-count={rendererOptions.length}>
                <span className="farm-renderer-value-track">
                  {[...rendererOptions, rendererOptions[0]].map((renderer, index) => (
                    <span
                      key={`${renderer}-${index}`}
                      className="farm-renderer-value-item text-white/94"
                    >
                      {renderer}
                      <span className="text-white/42">,</span>
                    </span>
                  ))}
                </span>
              </span>
            </span>
            <span className="sh__line">
              {"  "}
              <span className="text-white/78">server</span>
              <span className="text-white/42">: {`{`}</span>
            </span>
            <span className="sh__line">
              {"    "}
              <span className="text-white/78">runtime</span>
              <span className="text-white/42">: </span>
              <span className="text-white/94">&quot;node&quot;</span>
              <span className="text-white/42">,</span>
            </span>
            <span className="sh__line">
              <span className="text-white/42">{`  },`}</span>
            </span>
            <span className="sh__line">
              <span className="text-white/42">{`});`}</span>
            </span>
          </code>
        </pre>

        <div className="flex h-10 shrink-0 items-center justify-between border-t border-white/8 px-4 font-mono text-[8px] uppercase tracking-normal sm:text-[9px]">
          <span className="text-white/30">React by default</span>
          <span className="flex items-center gap-1.5 text-white/68">
            <Check aria-hidden className="size-3" strokeWidth={1.8} /> SSR + hydration
          </span>
        </div>
      </figure>
    </div>
  );
}

function RuntimeErrorVisual() {
  return (
    <div className="farm-feature-spotlight relative flex h-[340px] min-w-0 items-end justify-end overflow-hidden pl-6 sm:pl-10">
      <figure
        aria-label="FARMJS development runtime error overlay mapped to application source"
        className="relative z-10 -mb-px -mr-px flex h-[290px] w-full max-w-full shrink-0 flex-col overflow-hidden border border-white/10 bg-black shadow-[0_18px_50px_rgba(0,0,0,0.18)]"
      >
        <figcaption className="flex h-10 shrink-0 items-center justify-between border-b border-white/8 px-4 font-mono text-[9px] uppercase tracking-normal">
          <span className="flex items-center gap-2 text-white/56">
            <TriangleAlert aria-hidden className="size-3 text-red-300/80" strokeWidth={1.5} />
            Runtime error
          </span>
          <span className="border border-red-300/20 bg-red-300/[0.055] px-2 py-1 text-[8px] text-red-200/70">
            Development
          </span>
        </figcaption>

        <div className="flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="font-mono text-[8px] uppercase tracking-normal text-red-200/62">
                Runtime TypeError
              </span>
              <h4 className="mt-1 truncate text-[13px] font-medium tracking-normal text-white/90 sm:text-sm">
                Application failed in the browser
              </h4>
            </div>
            <span className="mt-0.5 shrink-0 border border-white/10 bg-white/[0.025] px-2 py-1 font-mono text-[8px] text-white/42">
              1 occurrence
            </span>
          </div>

          <div className="mt-3 min-h-0 overflow-hidden border border-white/10 bg-white/[0.018] font-mono text-[8px] tracking-normal sm:text-[9px]">
            <div className="flex h-8 min-w-0 items-center justify-between gap-3 border-b border-white/8 px-3">
              <span className="truncate text-white/54">src/app/dashboard/page.tsx:24:38</span>
              <span className="shrink-0 text-white/24">source mapped</span>
            </div>
            <div className="py-1.5">
              <div className="grid grid-cols-[2rem_minmax(0,1fr)] px-2 leading-5 text-white/34">
                <span className="text-right text-white/18">23</span>
                <code className="truncate pl-3">const profile = response.user.profile;</code>
              </div>
              <div className="grid grid-cols-[2rem_minmax(0,1fr)] border-l-2 border-red-300/70 bg-red-300/[0.06] px-2 leading-5 text-white/86">
                <span className="text-right text-red-200/56">24</span>
                <code className="truncate pl-3">profile.formatDisplayName();</code>
              </div>
              <div className="grid grid-cols-[2rem_minmax(0,1fr)] px-2 leading-5 text-white/34">
                <span className="text-right text-white/18">25</span>
                <code className="truncate pl-3">setDisplayName(name);</code>
              </div>
            </div>
          </div>

          <div className="mt-auto flex items-center gap-2 pt-3 font-mono text-[8px] uppercase tracking-normal sm:text-[9px]">
            <span className="inline-flex h-8 items-center gap-1.5 border border-white/18 bg-white px-3 text-black">
              <Copy aria-hidden className="size-3" strokeWidth={1.6} /> Copy report
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 border border-white/12 bg-white/[0.025] px-3 text-white/58">
              <RefreshCw aria-hidden className="size-3" strokeWidth={1.6} /> Reload
            </span>
          </div>
        </div>
      </figure>
    </div>
  );
}

function FeatureCell({
  index,
  icon: Icon,
  label,
  title,
  body,
  className,
  children,
}: {
  index: string;
  icon: LucideIcon;
  label: string;
  title: string;
  body: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={cx("group flex min-h-[500px] min-w-0 flex-col justify-between", className)}>
      <div className="p-6 sm:p-10">
        <div className="text-white/52">
          <IndexedLabel icon={Icon} index={index} label={label} />
        </div>
        <h3 className="mt-6 max-w-[31rem] text-balance font-geist-pixel text-xl font-medium leading-[1.2] tracking-normal text-white/92 sm:text-2xl">
          {title}
        </h3>
        <p className="mt-3 max-w-[31rem] text-sm leading-6 text-white/48 sm:text-base sm:leading-7">
          {body}
        </p>
      </div>
      {children}
    </article>
  );
}

function DeveloperExperienceGrid() {
  return (
    <section className="farm-full-rule grid w-full lg:grid-cols-2">
      <FeatureCell
        body="Start the whole app once, then see every page request and response time as you work."
        icon={Terminal}
        index="01.1"
        label="Development"
        title="A blazingly fast dev server"
      >
        <TerminalVisual />
      </FeatureCell>
      <FeatureCell
        body="Define an API route once. Farm.js generates a client with typed inputs and responses."
        className="border-t border-white/12 lg:border-l lg:border-t-0"
        icon={Braces}
        index="01.2"
        label="Typed APIs"
        title="Types from route to client"
      >
        <TypedApiVisual />
      </FeatureCell>
      <FeatureCell
        body="Connect billing, API keys, and more in one place. Pass existing provider instances and call every service through typed APIs."
        className="border-t border-white/12"
        icon={Plug}
        index="01.3"
        label="Integrations"
        title="Connect once. Keep full control."
      >
        <IntegrationVisual />
      </FeatureCell>
      <FeatureCell
        body="Farm.js packages routes, middleware, typed clients, and deployment config into one production build."
        className="border-t border-white/12 lg:border-l"
        icon={Rocket}
        index="01.4"
        label="Production"
        title="Build once. Deploy together."
      >
        <BuildVisual />
      </FeatureCell>
      <FeatureCell
        body="Keep React with zero config, or choose Preact, Solid, Vue, or Svelte. Routing, server features, SSR, and hydration stay on one contract."
        className="border-t border-white/12"
        icon={Code2}
        index="01.5"
        label="Renderers"
        title="Your UI runtime, your choice"
      >
        <RendererVisual />
      </FeatureCell>
      <FeatureCell
        body="Unhandled browser errors map to application source, group repeated failures, and offer copy and reload actions during development."
        className="border-t border-white/12 lg:border-l"
        icon={TriangleAlert}
        index="01.6"
        label="Diagnostics"
        title="Errors that point to the source"
      >
        <RuntimeErrorVisual />
      </FeatureCell>
    </section>
  );
}

function FoundationCanvas({
  children,
  interactive = false,
  spotlight = true,
}: {
  children: ReactNode;
  interactive?: boolean;
  spotlight?: boolean;
}) {
  return (
    <div
      aria-hidden={interactive ? undefined : true}
      className={cx(
        "relative h-[320px] min-w-0 overflow-hidden sm:h-[328px]",
        spotlight && "farm-feature-spotlight",
      )}
    >
      <div className="relative z-10 h-full w-full">{children}</div>
    </div>
  );
}

function FoundationCodeVisual({
  code,
  highlightLines,
  label,
  language,
}: {
  code: string;
  highlightLines?: readonly number[];
  label: string;
  language: string;
}) {
  return (
    <div className="farm-feature-spotlight relative flex h-[320px] min-w-0 items-end justify-end overflow-hidden pl-6 sm:h-[328px] sm:pl-10">
      <HighlightedCode
        className="relative z-10 -mb-px -mr-px flex h-[296px] w-full max-w-full shrink-0 flex-col sm:h-[300px]"
        code={code}
        highlightLines={highlightLines}
        label={label}
        language={language}
      />
    </div>
  );
}

function FoundationCodeTabsVisual({
  compact = false,
  id,
  tabs,
  tabsLabel,
}: {
  compact?: boolean;
  id: string;
  tabs: readonly [HighlightedCodeTab, ...HighlightedCodeTab[]];
  tabsLabel: string;
}) {
  return (
    <div className="farm-feature-spotlight relative flex h-[320px] min-w-0 items-end justify-end overflow-hidden pl-6 sm:h-[328px] sm:pl-10">
      <HighlightedCodeTabs
        className="relative z-10 -mb-px -mr-px flex h-[296px] w-full max-w-full shrink-0 flex-col sm:h-[300px]"
        compact={compact}
        id={id}
        tabs={tabs}
        tabsLabel={tabsLabel}
      />
    </div>
  );
}

function FileTreeVisual() {
  const nodes: readonly FileTreeNode[] = [
    {
      name: "app",
      type: "folder",
      meta: "root",
      defaultOpen: true,
      children: [
        { name: "layout.tsx", type: "file", extension: "tsx", meta: "shell" },
        { name: "page.tsx", type: "file", extension: "tsx", meta: "/" },
        {
          name: "dashboard",
          type: "folder",
          meta: "/dashboard",
          defaultOpen: true,
          children: [{ name: "page.tsx", type: "file", extension: "tsx", meta: "route" }],
        },
        {
          name: "api",
          type: "folder",
          meta: "/api",
          defaultOpen: true,
          children: [
            {
              name: "users",
              type: "folder",
              defaultOpen: true,
              children: [{ name: "route.ts", type: "file", extension: "route", meta: "GET" }],
            },
          ],
        },
      ],
    },
  ];

  return (
    <FoundationCanvas interactive>
      <FileTree
        className="farm-illustration-surface absolute -bottom-px -right-px top-4 w-[calc(100%-1.5rem)] sm:w-[calc(100%-2.5rem)]"
        data={nodes}
        defaultSelectedPath="app/page.tsx"
      />
    </FoundationCanvas>
  );
}

function DeploymentVisual() {
  return (
    <FoundationCanvas interactive spotlight={false}>
      <a
        aria-label="Explore Farm.js deployment targets"
        className="group/deployment absolute inset-0 flex items-center justify-center overflow-hidden px-6 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white sm:px-10"
        href="/docs/deployment"
        title="Deployment documentation"
      >
        <span
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(255_255_255/0.025),transparent_66%)]"
        />
        <div
          aria-hidden
          className="relative size-[19rem] sm:size-[20rem]"
          style={{
            maskImage:
              "radial-gradient(ellipse at center, black 68%, rgb(0 0 0 / 0.76) 86%, transparent 108%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, black 68%, rgb(0 0 0 / 0.76) 86%, transparent 108%)",
          }}
        >
          {deploymentTiles.map((tile) => (
            <div
              key={`${tile.row}_${tile.col}`}
              className={cx(
                "group/tile absolute flex size-[20%] items-center justify-center overflow-hidden rounded-none border border-white/[0.08] transition-[background-color,border-color] duration-150",
                tile.brand
                  ? "bg-white/[0.055] group-hover/deployment:border-white/[0.14] group-hover/deployment:bg-white/[0.075]"
                  : "bg-white/[0.012]",
              )}
              style={{
                left: `${tile.col * 20}%`,
                top: `${tile.row * 20}%`,
              }}
              title={tile.label}
            >
              {tile.brand ? (
                <>
                  <BrandIcon
                    className="size-7 opacity-72 transition-[opacity,transform] duration-150 group-hover/tile:-translate-y-1 group-hover/tile:opacity-90"
                    src={tile.brand}
                  />
                  <span className="pointer-events-none absolute inset-x-1 bottom-1 translate-y-1 truncate text-center font-mono text-[7px] font-normal uppercase tracking-normal text-white/68 opacity-0 transition-[opacity,transform] duration-150 group-hover/tile:translate-y-0 group-hover/tile:opacity-100">
                    {tile.label}
                  </span>
                </>
              ) : (
                <span className="size-px bg-white/12" />
              )}
            </div>
          ))}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-[22%] bg-gradient-to-l from-black via-black/60 to-transparent"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[22%] bg-gradient-to-t from-black via-black/60 to-transparent"
          />
        </div>
      </a>
    </FoundationCanvas>
  );
}

function DocsVisual() {
  return (
    <FoundationCodeVisual
      code={docsConfigCode}
      highlightLines={docsHighlightLines}
      label="farm.config.ts"
      language="ts"
    />
  );
}

function LayersVisual() {
  return (
    <FoundationCodeTabsVisual
      id="farm-layers-code"
      tabs={layersConfigTabs}
      tabsLabel="Farm Layers examples"
    />
  );
}

function StorageVisual() {
  return (
    <FoundationCodeTabsVisual
      id="farm-storage-code"
      tabs={storageCodeTabs}
      tabsLabel="Farm KV storage examples"
    />
  );
}

function AdvancedRoutesVisual() {
  return (
    <FoundationCodeTabsVisual
      compact
      id="farm-advanced-routes-code"
      tabs={routeCodeTabs}
      tabsLabel="Farm advanced route examples"
    />
  );
}

const optimizedBoundaryChecks = [
  ["Host-only tree", "pass"],
  ["Client code", "none"],
  ["Events or refs", "none"],
  ["Size gate", "pass"],
] as const;

function FeatureDiagramFrame({
  ariaLabel,
  href,
  icon: Icon,
  label,
  status,
  footerLabel,
  footerValue,
  children,
}: {
  ariaLabel: string;
  href: string;
  icon: LucideIcon;
  label: string;
  status: string;
  footerLabel: string;
  footerValue: string;
  children: ReactNode;
}) {
  return (
    <FoundationCanvas interactive>
      <a
        aria-label={ariaLabel}
        className="group/diagram absolute inset-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
        href={href}
      >
        <figure className="farm-illustration-surface absolute -bottom-px -right-px top-4 flex w-[calc(100%-1.5rem)] flex-col overflow-hidden border border-white/10 transition-colors duration-150 group-hover/diagram:border-white/18 sm:w-[calc(100%-2.5rem)]">
          <figcaption className="flex h-10 shrink-0 items-center justify-between border-b border-white/8 px-4 font-mono text-[9px] font-normal uppercase tracking-normal">
            <span className="flex items-center gap-1.5 text-white/54">
              <Icon aria-hidden className="size-3" strokeWidth={1.5} />
              {label}
            </span>
            <span className="border border-white/12 bg-white/[0.035] px-2 py-1 text-white/44">
              {status}
            </span>
          </figcaption>

          <div className="relative min-h-0 flex-1">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.018)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.018)_1px,transparent_1px)] bg-[size:24px_24px] opacity-55"
            />
            <div className="relative z-10 h-full">{children}</div>
          </div>

          <div className="flex h-12 shrink-0 items-center justify-between border-t border-white/10 bg-white/[0.025] px-4 font-mono text-[9px] font-normal uppercase tracking-normal sm:px-5">
            <span className="text-white/32">{footerLabel}</span>
            <span className="flex items-center gap-2 text-white/86">
              {footerValue}
              <ArrowRight
                aria-hidden
                className="size-3 transition-transform duration-150 group-hover/diagram:translate-x-0.5"
                strokeWidth={1.5}
              />
            </span>
          </div>
        </figure>
      </a>
    </FoundationCanvas>
  );
}

function DiagramConnector() {
  return (
    <div aria-hidden className="flex min-w-0 items-center">
      <span className="h-px min-w-0 flex-1 bg-white/12" />
      <span className="grid size-6 shrink-0 place-items-center border border-white/12 bg-black text-white/46">
        <ArrowRight className="size-2.5" strokeWidth={1.5} />
      </span>
      <span className="h-px min-w-0 flex-1 bg-white/12" />
    </div>
  );
}

function OptimizedBoundaryVisual() {
  return (
    <FeatureDiagramFrame
      ariaLabel="Read about automatic optimized boundaries"
      footerLabel="Selected renderer"
      footerValue="Strata / Rust"
      href="/docs/server-rendering#automatic-optimized-boundaries"
      icon={Cpu}
      label="Boundary analysis"
      status="Experimental"
    >
      <div className="grid h-full grid-cols-[minmax(0,0.88fr)_2.25rem_minmax(0,1.12fr)] items-center px-4 sm:grid-cols-[minmax(0,0.82fr)_3rem_minmax(0,1.18fr)] sm:px-5">
        <div className="flex h-[152px] min-w-0 flex-col border border-white/12 bg-black/88">
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/8 px-3 font-mono text-[8px] font-normal uppercase tracking-normal">
            <span className="text-white/34">Candidate</span>
            <span className="text-white/58">RSC</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2 text-center font-mono tracking-normal">
            <span className="border border-white/10 bg-white/[0.035] px-2 py-1 text-[7px] uppercase text-white/38 sm:text-[8px]">
              Server component
            </span>
            <span className="mt-3 text-[11px] text-white/86 sm:text-xs">&lt;article&gt;</span>
            <span className="mt-1 text-[8px] text-white/32 sm:text-[9px]">host-only region</span>
          </div>
        </div>

        <DiagramConnector />

        <div className="flex h-[152px] min-w-0 flex-col border border-white/12 bg-black/88">
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/8 px-3 font-mono text-[8px] font-normal uppercase tracking-normal">
            <span className="text-white/34">Runtime scan</span>
            <span className="flex items-center gap-1 text-white/68">
              <Check aria-hidden className="size-2.5" strokeWidth={1.8} /> Eligible
            </span>
          </div>
          <div className="min-h-0 flex-1 px-3">
            {optimizedBoundaryChecks.map(([label, value]) => (
              <div
                key={label}
                className="flex h-[30px] items-center justify-between border-b border-white/8 font-mono text-[8px] tracking-normal last:border-b-0 sm:text-[9px]"
              >
                <span className="truncate text-white/38">{label}</span>
                <span className="ml-2 flex shrink-0 items-center gap-1 text-white/68">
                  <Check aria-hidden className="size-2.5" strokeWidth={1.8} />
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </FeatureDiagramFrame>
  );
}

function MarkdownMirrorsVisual() {
  return (
    <FeatureDiagramFrame
      ariaLabel="Read about automatic Markdown mirrors"
      footerLabel="Content negotiation"
      footerValue="text/markdown"
      href="/docs/markdown"
      icon={FileOutput}
      label="Representation map"
      status="Automatic"
    >
      <div className="grid h-full grid-cols-[minmax(0,0.88fr)_2.25rem_minmax(0,1.12fr)] items-center px-4 sm:grid-cols-[minmax(0,0.82fr)_3rem_minmax(0,1.18fr)] sm:px-5">
        <div className="flex h-[152px] min-w-0 flex-col border border-white/12 bg-black/88">
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/8 px-3 font-mono text-[8px] font-normal uppercase tracking-normal">
            <span className="text-white/34">Source</span>
            <span className="text-white/58">Page</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2 text-center font-mono tracking-normal">
            <span className="border border-white/10 bg-white/[0.035] px-2 py-1 text-[7px] uppercase text-white/38 sm:text-[8px]">
              App route
            </span>
            <span className="mt-3 text-[11px] text-white/86 sm:text-xs">/pricing</span>
            <span className="mt-1 text-[8px] text-white/32 sm:text-[9px]">one source</span>
          </div>
        </div>

        <DiagramConnector />

        <div className="flex h-[152px] min-w-0 flex-col border border-white/12 bg-black/88">
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/8 px-3 font-mono text-[8px] font-normal uppercase tracking-normal">
            <span className="text-white/34">Representations</span>
            <span className="text-white/58">2 outputs</span>
          </div>
          <div className="grid min-h-0 flex-1 grid-rows-2">
            <div className="flex min-w-0 items-center justify-between border-b border-white/8 px-3 font-mono tracking-normal">
              <div className="min-w-0">
                <span className="block text-[7px] uppercase text-white/28 sm:text-[8px]">
                  Browser
                </span>
                <span className="mt-1 block truncate text-[9px] text-white/74 sm:text-[10px]">
                  /pricing
                </span>
              </div>
              <span className="ml-2 border border-white/10 bg-white/[0.025] px-2 py-1 text-[7px] uppercase text-white/48 sm:text-[8px]">
                HTML
              </span>
            </div>
            <div className="flex min-w-0 items-center justify-between px-3 font-mono tracking-normal">
              <div className="min-w-0">
                <span className="block text-[7px] uppercase text-white/28 sm:text-[8px]">
                  Agent
                </span>
                <span className="mt-1 block truncate text-[9px] text-white/86 sm:text-[10px]">
                  /pricing.md
                </span>
              </div>
              <span className="ml-2 border border-white/14 bg-white/[0.045] px-2 py-1 text-[7px] uppercase text-white/78 sm:text-[8px]">
                Markdown
              </span>
            </div>
          </div>
        </div>
      </div>
    </FeatureDiagramFrame>
  );
}

function AgentRuntimeVisual() {
  return (
    <FoundationCodeTabsVisual
      compact
      id="farm-agent-runtime-code"
      tabs={agentRuntimeCodeTabs}
      tabsLabel="Farm agent runtime examples"
    />
  );
}

function AgentClientVisual() {
  return (
    <FoundationCodeTabsVisual
      compact
      id="farm-agent-client-code"
      tabs={agentClientCodeTabs}
      tabsLabel="Farm agent client examples"
    />
  );
}

function FoundationGrid() {
  return (
    <section data-foundation-grid className="farm-full-rule grid w-full lg:grid-cols-2">
      <FeatureCell
        body="Build pages, layouts, API routes, loading states, and typed links in one app directory."
        icon={FolderTree}
        index="02.1"
        label="Routing"
        title="The app router you know"
      >
        <FileTreeVisual />
      </FeatureCell>
      <FeatureCell
        body="Ship to Vercel, Cloudflare, Netlify, or self-hosted Node with built-in Nitro presets."
        className="border-t border-white/12 lg:border-l lg:border-t-0"
        icon={CloudCog}
        index="02.2"
        label="Deployment"
        title="Deploy where you want"
      >
        <DeploymentVisual />
      </FeatureCell>
      <FeatureCell
        body="Enable a complete docs surface with MDX, navigation, search, MCP, and agent-ready endpoints from the same source."
        className="border-t border-white/12"
        icon={BookOpenText}
        index="02.3"
        label="Documentation"
        title="Docs for people and agents"
      >
        <DocsVisual />
      </FeatureCell>
      <FeatureCell
        body="Compose routes, middleware, integrations, components, and config from local or package layers. Project files always win."
        className="border-t border-white/12 lg:border-l"
        icon={Layers3}
        index="02.4"
        label="Layers"
        title="Share architecture, not boilerplate"
      >
        <LayersVisual />
      </FeatureCell>
      <FeatureCell
        body="Mount SQLite, Redis, S3, or another key/value driver for caches, settings, counters, idempotency records, and object-backed values."
        className="border-t border-white/12"
        icon={Database}
        index="02.5"
        label="KV Storage"
        title="Key/value storage for the runtime"
      >
        <StorageVisual />
      </FeatureCell>
      <FeatureCell
        body="Validate params, prepare request data, load the page, and run post-load work in one typed route definition."
        className="border-t border-white/12 lg:border-l"
        icon={Route}
        index="02.6"
        label="Advanced routes"
        title="Configure the whole route in one place"
      >
        <AdvancedRoutesVisual />
      </FeatureCell>
      <FeatureCell
        body={
          <>
            Farm detects large, host-only Server Component regions and renders eligible trees
            through{" "}
            <a
              className="font-medium text-white underline decoration-white/45 underline-offset-4 transition-[text-decoration-color] duration-150 hover:decoration-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              href="https://github.com/farming-labs/strata"
              rel="noreferrer"
              target="_blank"
            >
              Strata
            </a>
            {"'s Rust-native renderer. Everything else stays on React."}
          </>
        }
        className="border-t border-white/12"
        icon={Cpu}
        index="02.7"
        label="Experimental rendering"
        title="Native rendering for static regions"
      >
        <OptimizedBoundaryVisual />
      </FeatureCell>
      <FeatureCell
        body="Every app page receives a Markdown representation at a .md URL or through content negotiation. Keep the generated output or override it with page.md."
        className="border-t border-white/12 lg:border-l"
        icon={FileOutput}
        index="02.8"
        label="Markdown mirrors"
        title="Every page, readable by agents"
      >
        <MarkdownMirrorsVisual />
      </FeatureCell>
    </section>
  );
}

function AgentRuntimeIllustration() {
  return (
    <figure className="farm-feature-spotlight farm-agent-spotlight relative mx-auto h-[248px] w-full max-w-[28rem] overflow-hidden md:mx-0 md:h-[280px]">
      <figcaption className="sr-only">
        Farm connects the application origin to Eve on Vercel and Cloudflare Agents on Workers.
      </figcaption>

      <div className="relative z-10 grid h-full grid-cols-[minmax(0,0.82fr)_3rem_minmax(0,1.18fr)] items-center px-2 sm:px-4">
        <div className="border border-white/10 bg-black/80 p-3 sm:p-4">
          <div className="flex items-center gap-2 font-mono text-[10px] font-normal uppercase tracking-normal text-white/72">
            <Route aria-hidden className="size-3.5" strokeWidth={1.5} />
            Farm app
          </div>
          <div className="mt-3 border-t border-white/8 pt-3">
            <span className="block font-mono text-[8px] font-normal uppercase tracking-normal text-white/34 sm:text-[9px]">
              Same origin
            </span>
            <code className="mt-1 block font-mono text-xs text-white/86">/</code>
          </div>
        </div>

        <div aria-hidden className="relative h-[184px]">
          <span className="absolute left-0 top-1/2 h-px w-1/2 bg-white/22" />
          <span className="absolute bottom-1/4 left-1/2 top-1/4 w-px bg-white/22" />
          <span className="absolute left-1/2 right-0 top-1/4 h-px bg-white/22" />
          <span className="absolute bottom-1/4 left-1/2 right-0 h-px bg-white/22" />
          <span className="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 bg-white" />
          <span className="absolute right-0 top-1/4 size-1 -translate-y-1/2 bg-white/52" />
          <span className="absolute bottom-1/4 right-0 size-1 translate-y-1/2 bg-white/52" />
        </div>

        <div className="grid h-[184px] grid-rows-2 gap-3">
          <div className="border border-white/10 bg-black/80 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 font-mono text-[9px] font-normal uppercase tracking-normal text-white/76 sm:text-[10px]">
                <Workflow aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />
                Eve
              </span>
              <BrandIcon className="size-3.5 opacity-52" src={vercelIconUrl} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/8 pt-2">
              <code className="font-mono text-[9px] text-white/76">/eve/*</code>
              <span className="font-mono text-[8px] font-normal uppercase tracking-normal text-white/32">
                Vercel
              </span>
            </div>
          </div>

          <div className="border border-white/10 bg-black/80 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 font-mono text-[9px] font-normal uppercase tracking-normal text-white/76 sm:text-[10px]">
                <BrandIcon className="size-3.5 shrink-0 opacity-72" src={cloudflareIconUrl} />
                <span className="truncate">Cloudflare Agents</span>
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/8 pt-2">
              <code className="font-mono text-[9px] text-white/76">/agents/*</code>
              <span className="font-mono text-[8px] font-normal uppercase tracking-normal text-white/32">
                Workers
              </span>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

function AgentSectionIntro() {
  return (
    <section id="agents" className="farm-wide-rule grid w-full lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="flex items-start border-b border-white/12 p-6 text-white/36 sm:px-6 sm:py-8 lg:border-b-0 lg:border-r">
        <IndexedLabel icon={Bot} index="03" label="Agent systems" />
      </div>

      <div className="relative grid min-w-0 items-center gap-8 overflow-hidden bg-black px-6 py-10 sm:px-10 sm:py-12 md:grid-cols-[minmax(0,1fr)_20rem] lg:min-h-[420px] lg:gap-10 lg:px-12 xl:h-[420px] xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="relative z-10 flex min-w-0 items-center">
          <div className="min-w-0 max-w-lg">
            <h2 className="text-balance text-3xl font-medium leading-[1.06] tracking-normal text-white sm:text-4xl">
              Bring the agent runtime you already use
            </h2>
            <p className="mt-5 text-sm leading-6 text-white/48 sm:text-base sm:leading-7">
              Run Eve on Vercel or Cloudflare Agents on Workers. Farm joins each runtime to your app
              in development and production while its native SDK stays intact.
            </p>
            <div className="mt-8 flex items-center">
              <ButtonLink
                href="/docs/integrations#agent-runtimes"
                icon={<BookOpenText aria-hidden className="size-4" strokeWidth={1.5} />}
              >
                Agent Integrations
              </ButtonLink>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-center md:justify-end">
          <AgentRuntimeIllustration />
        </div>
      </div>
    </section>
  );
}

function AgentFeatureGrid() {
  return (
    <section data-agent-grid className="farm-full-rule grid w-full lg:grid-cols-2">
      <FeatureCell
        body="Choose Eve or Cloudflare Agents. Farm starts the runtime in development, owns its same-origin routes, and composes supported production output."
        icon={Bot}
        index="03.1"
        label="Agent runtimes"
        title="Run agents beside the app"
      >
        <AgentRuntimeVisual />
      </FeatureCell>
      <FeatureCell
        body="Use useEveAgent for durable conversations or useAgent for typed WebSocket state and RPC. Farm does not add a duplicate client layer."
        className="border-t border-white/12 lg:border-l lg:border-t-0"
        icon={Network}
        index="03.2"
        label="Native clients"
        title="Keep the provider-native SDK"
      >
        <AgentClientVisual />
      </FeatureCell>
    </section>
  );
}

function IntegrationsSection() {
  return (
    <section
      id="integrations"
      className="farm-wide-rule grid w-full lg:grid-cols-[14rem_minmax(0,1fr)]"
    >
      <div className="flex items-start border-b border-white/12 p-6 text-white/36 sm:px-6 sm:py-8 lg:border-b-0 lg:border-r">
        <IndexedLabel icon={Blocks} index="01" label="Connected systems" />
      </div>

      <div className="relative grid min-w-0 items-center gap-8 overflow-hidden bg-black px-6 py-10 sm:px-10 sm:py-12 md:grid-cols-[minmax(0,1fr)_20rem] lg:min-h-[440px] lg:gap-10 lg:px-12 xl:h-[440px] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="relative z-10 flex items-center">
          <div className="max-w-lg">
            <h2 className="text-balance text-3xl font-medium leading-[1.06] tracking-normal text-white sm:text-4xl">
              Bring the tools you already use
            </h2>
            <p className="mt-5 text-sm leading-6 text-white/48 sm:text-base sm:leading-7">
              Start with built-in Farm Auth, keep full control with Better Auth, then add
              integrations for billing, email, jobs, KV storage, agents, API keys, and UI—or connect
              your own.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <ButtonLink
                href="/docs/integrations"
                icon={<BookOpenText aria-hidden className="size-4" strokeWidth={1.5} />}
              >
                Explore Integrations
              </ButtonLink>
            </div>
          </div>
        </div>

        <div className="farm-integration-visual relative z-10 flex items-center justify-center md:h-full md:min-h-0 md:justify-end">
          <div className="farm-integration-directory relative aspect-[5/6] w-full max-w-72 md:w-[21rem] md:max-w-none md:shrink-0 md:translate-x-12 xl:w-96 xl:translate-x-16">
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgb(255 255 255 / 0.11) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.11) 1px, transparent 1px)",
                backgroundSize: "20% 16.6666667%",
                maskImage: "radial-gradient(ellipse at center, black 68%, transparent 100%)",
                WebkitMaskImage: "radial-gradient(ellipse at center, black 68%, transparent 100%)",
              }}
            />

            {integrationDirectoryItems.map((item) => {
              const Icon = "icon" in item ? item.icon : null;

              return (
                <a
                  key={item.label}
                  aria-label={`${item.label} integration documentation`}
                  className="group absolute grid place-items-center bg-white/[0.055] transition-[background-color,color] duration-150 hover:z-10 hover:bg-white focus-visible:z-10 focus-visible:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
                  href={item.href}
                  style={{
                    height: "16.6666667%",
                    left: `${item.col * 20}%`,
                    top: `${item.row * (100 / 6)}%`,
                    width: "20%",
                  }}
                  title={`${item.label} integration`}
                >
                  {"brand" in item ? (
                    <BrandIcon
                      className="size-7 opacity-60 transition-[filter,opacity,transform] duration-150 group-hover:-translate-y-1 group-hover:invert-0 group-hover:opacity-100 group-focus-visible:-translate-y-1 group-focus-visible:invert-0 group-focus-visible:opacity-100"
                      src={item.brand}
                    />
                  ) : Icon ? (
                    <Icon
                      aria-hidden
                      className="size-7 text-white/60 transition-[color,transform] duration-150 group-hover:-translate-y-1 group-hover:text-black group-focus-visible:-translate-y-1 group-focus-visible:text-black"
                      strokeWidth={1.35}
                    />
                  ) : null}
                  <span className="pointer-events-none absolute inset-x-1 bottom-1 translate-y-1 truncate text-center font-mono text-[7px] font-normal uppercase tracking-normal text-black/55 opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                    {item.label}
                  </span>
                </a>
              );
            })}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 z-20 w-[22%] bg-gradient-to-l from-black via-black/60 to-transparent"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[18%] bg-gradient-to-t from-black via-black/60 to-transparent"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="farm-full-rule w-full">
      <div className="px-6 py-10 text-center sm:px-10 sm:py-12">
        <h2 className="text-balance font-geist-pixel text-xl font-medium leading-[1.15] tracking-normal text-white sm:text-2xl">
          One framework. The whole product.
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-balance text-sm leading-6 text-white/48 sm:text-base">
          Build routing, APIs, integrations, agents, docs, and deployment together in one React
          framework.
        </p>
      </div>
      <div className="farm-top-rule flex items-center justify-center bg-white/[0.035] p-4">
        <ButtonLink
          href="/docs/getting-started"
          icon={<Rocket aria-hidden className="size-4" strokeWidth={1.5} />}
        >
          Get Started
        </ButtonLink>
      </div>
    </section>
  );
}

type FooterLink = readonly [label: string, href: string];

function FooterActionLink({
  brand,
  href,
  icon: Icon,
  label,
}: {
  brand: string | null;
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  const DirectionIcon = href.startsWith("http") ? ArrowUpRight : ArrowRight;

  return (
    <a
      className="group flex h-12 items-center justify-between border-b border-white/12 px-4 font-mono text-[9px] font-normal uppercase !tracking-[0.04em] text-white/58 transition-[background-color,color] duration-150 hover:bg-white/[0.035] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
      href={href}
    >
      <span className="flex min-w-0 items-center gap-2">
        {brand ? (
          <BrandIcon className="size-3.5 shrink-0 opacity-72" src={brand} />
        ) : (
          <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />
        )}
        <span className="truncate">{label}</span>
      </span>
      <DirectionIcon
        aria-hidden
        className="size-3.5 shrink-0 text-white/30 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-white/72"
        strokeWidth={1.5}
      />
    </a>
  );
}

function FooterLinksGroup({ title, links }: { title: string; links: readonly FooterLink[] }) {
  return (
    <div className="px-4 py-4 md:min-h-[154px]">
      <h3 className="mb-2 font-mono text-[10px] font-normal uppercase !tracking-[0.04em] text-white/34">
        {title}
      </h3>
      <ul className="grid">
        {links.map(([label, href]) => {
          const DirectionIcon = href.startsWith("http") ? ArrowUpRight : ArrowRight;
          const isGitHub = href.includes("github.com");

          return (
            <li key={label}>
              <a
                className="group flex min-h-7 items-center justify-between gap-2 font-mono text-[9px] font-normal uppercase !tracking-[0.04em] text-white/48 transition-colors duration-150 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                href={href}
              >
                <span className="flex items-center gap-2">
                  {isGitHub ? <GithubIcon className="size-3.5 opacity-72" /> : null}
                  <span>{label}</span>
                </span>
                <DirectionIcon
                  aria-hidden
                  className="size-3 shrink-0 text-white/0 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-white/56"
                  strokeWidth={1.5}
                />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Footer() {
  return (
    <footer className="w-full">
      <div className="grid grid-cols-1 divide-y divide-white/12 md:grid-cols-4 md:divide-x md:divide-y-0">
        <div>
          <div className="flex h-12 items-center border-b border-white/12 px-4">
            <BrandLockup />
          </div>
          <div className="px-4 py-4 md:min-h-[154px]">
            <p className="max-w-[15rem] font-mono text-[9px] font-normal uppercase leading-5 !tracking-[0.04em] text-white/42">
              A Framework for Product integrated Apps
            </p>
          </div>
        </div>
        {footerGroups.map((group) => (
          <div key={group.title}>
            <FooterActionLink
              brand={group.brand}
              href={group.action[1]}
              icon={group.icon}
              label={group.action[0]}
            />
            <FooterLinksGroup links={group.links} title={group.title} />
          </div>
        ))}
      </div>
      <div className="farm-top-rule flex flex-col gap-2 px-4 py-3 font-mono text-[10px] font-normal uppercase !tracking-[0.04em] text-white/34 sm:flex-row sm:items-center sm:justify-between">
        <span>&copy; {new Date().getFullYear()} Farm.js</span>
        <a
          className="inline-flex items-center gap-1.5 transition-colors duration-150 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          href="https://www.farming-labs.dev"
        >
          farming-labs.dev <ExternalLink aria-hidden className="size-3" strokeWidth={1.5} />
        </a>
      </div>
    </footer>
  );
}

export default function HomePage(_props: PageProps) {
  return (
    <div className="farm-home min-h-screen overflow-x-hidden bg-black font-sans text-white selection:bg-white selection:text-black">
      <AnnouncementBar />
      <div className="farm-page-grid">
        <div aria-hidden className="farm-page-rail" />
        <div className="farm-page-content min-w-0">
          <Header />
          <main>
            <Hero />
            <EcosystemStrip />
            <DeveloperExperienceGrid />
            <BenchmarkSection />
            <IntegrationsSection />
            <FoundationGrid />
            <AgentSectionIntro />
            <AgentFeatureGrid />
            <FinalCta />
          </main>
          <Footer />
        </div>
        <div aria-hidden className="farm-page-rail" />
      </div>
    </div>
  );
}
