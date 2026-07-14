import type { PageProps } from "@farmjs/core";
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  BookOpen,
  BookOpenText,
  Braces,
  CircleCheck,
  CloudCog,
  CreditCard,
  ExternalLink,
  FileText,
  FolderTree,
  Gauge,
  GitCompareArrows,
  GitFork,
  KeyRound,
  Layers3,
  Menu,
  Network,
  Plug,
  Rocket,
  Route,
  Settings2,
  ShieldCheck,
  Terminal,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
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
import nitroIconUrl from "../assets/nitro.svg?url";
import { HeroTitleFrame } from "../components/home/hero-title-frame";
import { HighlightedCode } from "../components/home/highlighted-code";
import { InstallCommand } from "../components/home/install-command";
import { FileTree } from "../components/ui/file-tree";
import type { FileTreeNode } from "../components/ui/file-tree";
import { FlickeringGrid } from "../components/ui/flickering-grid";

export const metadata = {
  title: "Farm.js - The React framework for product apps",
  description:
    "Farm.js brings app routing, typed APIs, middleware, integrations, docs, migrations, and production deployment into one React framework.",
};

const navItems = [
  { index: "01", label: "Guide", href: "/docs/getting-started", icon: BookOpen },
  { index: "02", label: "Config", href: "/docs/configuration", icon: Settings2 },
  { index: "03", label: "Integrations", href: "/docs/integrations", icon: Blocks },
  { index: "04", label: "Resources", href: "/docs", icon: FileText },
] as const;

const ecosystemItems = [
  { label: "React 19", brand: reactIconUrl },
  { label: "Vite", brand: viteIconUrl },
  { label: "Nitro", brand: nitroIconUrl },
  { label: "Prisma", brand: prismaIconUrl },
  { label: "Better Auth", brand: betterAuthIconUrl },
  { label: "Stripe", brand: stripeIconUrl },
] as const;

const integrationDirectoryItems = [
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
    icon: ShieldCheck,
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
    icon: Blocks,
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
    icon: Gauge,
  },
  {
    row: 3,
    col: 0,
    label: "Polar",
    href: "/docs/integrations/polar",
    icon: CreditCard,
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
    icon: Network,
  },
  {
    row: 5,
    col: 0,
    label: "Trigger.dev",
    href: "/docs/integrations/trigger",
    icon: Workflow,
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
    icon: KeyRound,
  },
] as const;

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
    links: [
      ["Getting started", "/docs/getting-started"],
      ["Routing", "/docs/routing"],
      ["Middleware", "/docs/middleware"],
    ],
  },
  {
    title: "Product",
    icon: Layers3,
    links: [
      ["Integrations", "/docs/integrations"],
      ["API client", "/docs/api-client"],
      ["Deployment", "/docs/deployment"],
    ],
  },
  {
    title: "Open source",
    icon: GitFork,
    links: [
      ["GitHub", "https://github.com/Kinfe123/farm.js"],
      ["Migrations", "/docs/migrations"],
      ["Plugin guide", "/docs/plugins/create-plugin"],
    ],
  },
] as const;

const typedApiCode = `const user = await api.users.get({
  params: { id: "user_123" },
});

user.name;
//   ^? string`;

const integrationConfigCode = `import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  integrations: [
    auth(),
    billing(),
    jobs(),
  ],
});`;

const docsConfigCode = `import { defineDocs } from "@farming-labs/docs";

export default defineDocs({
  entry: "docs",
  docsPath: "/docs",
  search: { enabled: true },
  pageActions: { copyMarkdown: { enabled: true } },
});`;

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
  icon: LucideIcon;
  label: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-normal uppercase tracking-normal text-current">
      <span className="text-white/26">{index}</span>
      <span aria-hidden className="text-white/18">
        /
      </span>
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function FarmMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 32 32">
      <path d="M4 5h24v5H10v5h13v5H10v7H4V5Z" fill="currentColor" />
      <path d="M22 5h6l-5 5h-6l5-5Z" fill="black" />
    </svg>
  );
}

function Wordmark() {
  return (
    <a
      aria-label="Farm.js home"
      className="flex shrink-0 items-center gap-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
      href="/"
    >
      <span className="grid size-7 place-items-center bg-white text-black">
        <FarmMark className="size-5" />
      </span>
      <span className="font-mono text-[13px] font-normal uppercase tracking-normal">
        FARM<span className="text-white/52">.JS</span>
      </span>
    </a>
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
      className="farm-announcement flex h-5 items-center justify-center border-b border-white/12 px-4 font-mono text-[10px] font-normal uppercase tracking-normal text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
      href="https://github.com/Kinfe123/farm.js"
    >
      <GitFork aria-hidden className="mr-2 size-3 text-white/48" strokeWidth={1.5} />
      <span className="mr-3 hidden text-white/30 sm:inline">Open source / MIT</span>
      Farm.js beta is building in public
      <ExternalLink aria-hidden className="ml-2 size-3 text-white" strokeWidth={1.5} />
    </a>
  );
}

function Header() {
  return (
    <header className="farm-full-rule sticky top-0 z-50 bg-black/94 backdrop-blur-xl">
      <div className="flex h-11 w-full items-stretch">
        <div className="flex shrink-0 items-center px-4 sm:px-7">
          <Wordmark />
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
            href="https://github.com/Kinfe123/farm.js"
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
          <IndexedLabel icon={Route} index="00" label="App Router / Typed APIs / One Runtime" />
        </div>
        <HeroTitleFrame>
          <h1 className="max-w-[18ch] text-[1.875rem] font-medium leading-[1.02] tracking-normal text-white min-[400px]:text-[2.125rem] min-[420px]:text-[2.5rem] sm:text-[3.75rem] lg:text-[4rem]">
            <span className="block">A React Framework</span>
            <span className="block text-white/82">for Product Apps</span>
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

function EcosystemStrip() {
  return (
    <section className="farm-full-rule w-full">
      <div className="grid h-16 grid-cols-[11rem_minmax(0,1fr)] sm:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center border-r border-white/12 px-4 text-white/36 sm:px-8">
          <IndexedLabel icon={Layers3} index="01" label="Product stack" />
        </div>
        <div
          aria-label="Product stack logos. Focus to pause animation."
          className="farm-logo-viewport min-w-0 overflow-hidden focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-white/28"
          role="region"
          tabIndex={0}
        >
          <div className="farm-logo-rail flex h-full w-max">
            {([0, 1] as const).map((copyIndex) => (
              <div
                key={copyIndex}
                aria-hidden={copyIndex === 1 ? true : undefined}
                className="farm-logo-rail-copy flex h-full shrink-0"
              >
                {ecosystemItems.map((item, itemIndex) => (
                  <div
                    key={`${copyIndex}-${item.label}`}
                    className={cx(
                      "flex h-16 w-40 shrink-0 items-center justify-center gap-3 border-r border-white/12 bg-black px-4 font-mono text-[10px] font-normal uppercase tracking-normal text-white/48 transition-colors duration-150 hover:bg-white/[0.07] hover:text-white/82 sm:w-44 sm:text-[11px]",
                      itemIndex % 2 === 0 && "bg-white/[0.045]",
                    )}
                  >
                    <BrandIcon className="size-[18px] shrink-0 opacity-72" src={item.brand} />
                    <span className="whitespace-nowrap">{item.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
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
        <pre className="min-h-0 flex-1 overflow-x-auto p-5 font-mono text-[11px] leading-6 tracking-normal sm:text-xs">
          <code className="block min-w-max">
            <span className="block text-white/48">$ pnpm dev</span>
            <span className="mt-2 block text-white">
              <span className="font-semibold text-white">FARM</span> v0.0.3 ready in 126ms
            </span>
            <span className="block text-white/54">
              <span className="text-white/82">Local</span> http://localhost:3000
            </span>
            <span className="block text-white/54">
              <span className="text-white/82">Graph</span> 32 routes / 8 integrations
            </span>
            <span className="mt-2 block text-white/32">press h + enter to show help</span>
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
        label="/api/users/:id"
        language="tsx"
        prefix="GET"
      />
    </div>
  );
}

function IntegrationVisual() {
  return (
    <div className="farm-feature-spotlight relative flex h-[340px] min-w-0 items-end justify-end overflow-hidden pl-6 sm:pl-10">
      <HighlightedCode
        className="relative z-10 -mb-px -mr-px flex h-[290px] w-full max-w-full shrink-0 flex-col"
        code={integrationConfigCode}
        label="farm.config.ts"
        language="ts"
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
        <pre className="min-h-0 flex-1 overflow-x-auto p-5 font-mono text-[10px] leading-6 tracking-normal text-white/58 sm:text-[11px]">
          <code className="block min-w-max">
            <span className="block text-white">$ farm build --target vercel</span>
            <span className="mt-2 block">
              <span className="text-white">ok</span> route manifest ........ 44 routes
            </span>
            <span className="block">
              <span className="text-white">ok</span> middleware .............. 6 matchers
            </span>
            <span className="block">
              <span className="text-white">ok</span> generated client ........ 12 APIs
            </span>
            <span className="block">
              <span className="text-white">ok</span> deployment output ....... .vercel/output
            </span>
            <span className="mt-2 block text-white/78">built in 842ms</span>
          </code>
        </pre>
      </figure>
    </div>
  );
}

function FeatureCell({
  index,
  icon: Icon,
  title,
  body,
  className,
  children,
}: {
  index: string;
  icon: LucideIcon;
  title: string;
  body: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={cx("group flex min-h-[500px] min-w-0 flex-col justify-between", className)}>
      <div className="p-6 sm:p-10">
        <h3 className="text-white/52">
          <IndexedLabel icon={Icon} index={index} label={title} />
        </h3>
        <p className="mt-6 max-w-[31rem] font-geist-pixel text-xl font-medium leading-[1.28] tracking-normal text-white/88 sm:text-2xl">
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
        body="Start the app, route graph, generated clients, docs, and integration runtime together with one command."
        icon={Terminal}
        index="01.1"
        title="One Server, Entire Product"
      >
        <TerminalVisual />
      </FeatureCell>
      <FeatureCell
        body="Route handlers and generated callers share the same contract, from params to the final Response."
        className="border-t border-white/12 lg:border-l lg:border-t-0"
        icon={Braces}
        index="01.2"
        title="Typed From Route to Client"
      >
        <TypedApiVisual />
      </FeatureCell>
      <FeatureCell
        body="Auth, billing, email, jobs, storage, and docs register through one framework-level integration surface."
        className="border-t border-white/12"
        icon={Plug}
        index="01.3"
        title="Product Systems Included"
      >
        <IntegrationVisual />
      </FeatureCell>
      <FeatureCell
        body="The build carries routes, middleware, generated clients, and platform manifests into production together."
        className="border-t border-white/12 lg:border-l"
        icon={Rocket}
        index="01.4"
        title="Deployment-Aware Output"
      >
        <BuildVisual />
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
  label,
  language,
}: {
  code: string;
  label: string;
  language: string;
}) {
  return (
    <div className="farm-feature-spotlight relative flex h-[320px] min-w-0 items-end justify-end overflow-hidden pl-6 sm:h-[328px] sm:pl-10">
      <HighlightedCode
        className="relative z-10 -mb-px -mr-px flex h-[296px] w-full max-w-full shrink-0 flex-col sm:h-[300px]"
        code={code}
        label={label}
        language={language}
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
                "group/tile absolute flex size-[20%] items-center justify-center overflow-hidden rounded-[3px] border border-white/[0.08] transition-[background-color,border-color] duration-150",
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
        </div>
      </a>
    </FoundationCanvas>
  );
}

function DocsVisual() {
  return <FoundationCodeVisual code={docsConfigCode} label="docs.config.ts" language="ts" />;
}

function MigrationVisual() {
  const rows = [
    { source: "/dashboard", target: "app/dashboard", icon: FileText },
    { source: "/api/users", target: "api/users/route", icon: Braces },
    { source: "middleware", target: "middleware.ts", icon: ShieldCheck },
  ] as const;

  return (
    <FoundationCanvas>
      <div className="farm-migration-source farm-illustration-surface absolute left-6 top-6 z-10 h-[10.5rem] w-[64%] max-w-[22rem] overflow-hidden border border-white/10 bg-black opacity-60 shadow-[0_14px_40px_rgba(0,0,0,0.45)] sm:left-10 sm:top-8">
        <div className="flex h-9 items-center justify-between border-b border-white/10 px-3 font-mono text-[8px] uppercase text-white/40">
          <span>source inventory</span>
          <span className="text-white/68">next.js</span>
        </div>
        <div className="grid h-[calc(100%-2.25rem)] grid-rows-3">
          {rows.map((row, index) => {
            const Icon = row.icon;

            return (
              <div
                key={row.source}
                className="farm-migration-row flex min-h-0 min-w-0 items-center gap-2.5 border border-transparent px-3 font-mono text-[9px] tracking-normal text-white/50 sm:text-[10px]"
                data-initial={index === 0 ? "true" : undefined}
                style={{ animationDelay: index * 2 + "s" }}
              >
                <Icon aria-hidden className="size-3.5 shrink-0 text-white/64" strokeWidth={1.4} />
                <span className="truncate">{row.source}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="farm-migration-link absolute left-[48%] top-[42%] z-20 flex items-center gap-2 text-white/62 sm:left-[54%] sm:top-[44%]">
        <span className="h-px w-8 bg-white/18 sm:w-12" />
        <GitCompareArrows aria-hidden className="size-5" strokeWidth={1.35} />
      </div>

      <div className="farm-migration-target farm-illustration-surface absolute -bottom-px -right-px z-30 h-[13rem] w-[72%] max-w-[25rem] overflow-hidden border border-white/14 bg-black shadow-[-24px_-20px_56px_rgba(0,0,0,0.72)] sm:h-[13.5rem] sm:w-[70%]">
        <div className="flex h-9 items-center justify-between border-b border-white/10 px-3 font-mono text-[8px] uppercase text-white/40">
          <span>farm manifest</span>
          <span className="flex items-center gap-1.5 text-white/72">
            <CircleCheck aria-hidden className="size-3" strokeWidth={1.5} /> 0 conflicts
          </span>
        </div>

        <div className="grid h-[calc(100%-4.25rem)] grid-rows-3">
          {rows.map((row, index) => {
            const Icon = row.icon;

            return (
              <div
                key={row.target}
                className="farm-migration-row grid min-h-0 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 border border-transparent px-3 font-mono text-[9px] tracking-normal text-white/50 sm:text-[10px]"
                data-initial={index === 0 ? "true" : undefined}
                style={{ animationDelay: index * 2 + "s" }}
              >
                <Icon aria-hidden className="size-3.5 shrink-0 text-white/66" strokeWidth={1.4} />
                <span className="truncate">{row.target}</span>
                <CircleCheck aria-hidden className="size-3 text-white/70" strokeWidth={1.5} />
              </div>
            );
          })}
        </div>

        <div className="absolute bottom-0 left-0 right-0 flex h-8 items-center gap-3 border-t border-white/10 px-3">
          <span className="h-px flex-1 overflow-hidden bg-white/10">
            <span className="farm-migration-progress block h-full origin-left bg-white/76" />
          </span>
          <span className="font-mono text-[8px] uppercase tracking-normal text-white/56">
            32 / 32 mapped
          </span>
        </div>
      </div>
    </FoundationCanvas>
  );
}

function FoundationGrid() {
  return (
    <section data-foundation-grid className="farm-full-rule grid w-full lg:grid-cols-2">
      <FeatureCell
        body="Pages, layouts, route handlers, loading states, markdown, and typed links live in the app directory."
        icon={FolderTree}
        index="02.1"
        title="A Familiar App Router"
      >
        <FileTreeVisual />
      </FeatureCell>
      <FeatureCell
        body="Deploy to Vercel, Cloudflare, Netlify, or self-hosted Node, then reach the wider provider ecosystem through Nitro presets."
        className="border-t border-white/12 lg:border-l lg:border-t-0"
        icon={CloudCog}
        index="02.2"
        title="Deploy Almost Anywhere"
      >
        <DeploymentVisual />
      </FeatureCell>
      <FeatureCell
        body="The documentation site ships beside the product, with MDX pages, references, and OpenAPI surfaces."
        className="border-t border-white/12"
        icon={BookOpenText}
        index="02.3"
        title="Docs Are Part of the App"
      >
        <DocsVisual />
      </FeatureCell>
      <FeatureCell
        body="Inventory routes from Next.js, Remix, Express, and custom servers before changing application source."
        className="border-t border-white/12 lg:border-l"
        icon={GitCompareArrows}
        index="02.4"
        title="Migrate With Evidence"
      >
        <MigrationVisual />
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
              Connect the systems your product already uses
            </h2>
            <p className="mt-5 text-sm leading-6 text-white/48 sm:text-base sm:leading-7">
              Auth, billing, email, jobs, storage, API keys, and UI scaffolds register through one
              framework-level integration contract.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <ButtonLink
                href="/docs/integrations"
                icon={<BookOpenText aria-hidden className="size-4" strokeWidth={1.5} />}
              >
                Explore Integrations
              </ButtonLink>
              <ButtonLink
                href="/docs/integrations/custom"
                icon={<Plug aria-hidden className="size-4" strokeWidth={1.5} />}
                variant="secondary"
              >
                Custom Integration
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
          Build routing, APIs, integrations, docs, and deployment together in one React framework.
        </p>
      </div>
      <div className="farm-top-rule flex flex-col items-center justify-center gap-2 bg-white/[0.035] p-4 sm:flex-row">
        <ButtonLink
          href="/docs"
          icon={<BookOpenText aria-hidden className="size-4" strokeWidth={1.5} />}
          variant="secondary"
        >
          Read the Docs
        </ButtonLink>
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

function Footer() {
  return (
    <footer className="w-full">
      <div className="grid gap-12 px-6 py-14 sm:px-10 lg:grid-cols-[1fr_1.4fr] lg:px-14">
        <div>
          <Wordmark />
          <p className="mt-5 max-w-sm text-sm leading-6 text-white/38">
            A React framework for building integrated product applications.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-normal text-white/42">
                <group.icon aria-hidden className="size-3.5" strokeWidth={1.5} />
                {group.title}
              </h3>
              <div className="mt-4 grid gap-3">
                {group.links.map(([label, href]) => (
                  <a
                    key={label}
                    className="group flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-normal text-white/48 hover:text-white"
                    href={href}
                  >
                    <span>{label}</span>
                    {href.startsWith("http") ? (
                      <ArrowUpRight
                        aria-hidden
                        className="size-3 opacity-0 transition-opacity group-hover:opacity-100"
                        strokeWidth={1.5}
                      />
                    ) : (
                      <ArrowRight
                        aria-hidden
                        className="size-3 opacity-0 transition-opacity group-hover:opacity-100"
                        strokeWidth={1.5}
                      />
                    )}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="farm-top-rule flex flex-col gap-2 px-6 py-5 font-mono text-[10px] tracking-normal text-white/28 sm:flex-row sm:items-center sm:justify-between sm:px-10 lg:px-14">
        <span>MIT License / Farm.js Team</span>
        <a className="inline-flex items-center gap-1.5 hover:text-white" href="https://kinfish.dev">
          kinfish.dev <ExternalLink aria-hidden className="size-3" strokeWidth={1.5} />
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
            <IntegrationsSection />
            <FoundationGrid />
            <FinalCta />
          </main>
          <Footer />
        </div>
        <div aria-hidden className="farm-page-rail" />
      </div>
    </div>
  );
}
