import type { PageProps } from "@farmjs/core";
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  BookOpen,
  BookOpenText,
  Braces,
  CreditCard,
  Database,
  ExternalLink,
  FileCode2,
  FileText,
  Gauge,
  GitFork,
  KeyRound,
  Layers3,
  Mail,
  Menu,
  Network,
  Plug,
  Rocket,
  Route,
  ServerCog,
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
import githubIconUrl from "simple-icons/icons/github.svg?url";
import prismaIconUrl from "simple-icons/icons/prisma.svg?url";
import reactIconUrl from "simple-icons/icons/react.svg?url";
import resendIconUrl from "simple-icons/icons/resend.svg?url";
import shadcnIconUrl from "simple-icons/icons/shadcnui.svg?url";
import stripeIconUrl from "simple-icons/icons/stripe.svg?url";
import supabaseIconUrl from "simple-icons/icons/supabase.svg?url";
import viteIconUrl from "simple-icons/icons/vite.svg?url";
import nitroIconUrl from "../assets/nitro.svg?url";
import { HeroTitleFrame } from "../components/home/hero-title-frame";
import { HighlightedCode } from "../components/home/highlighted-code";
import { InstallCommand } from "../components/home/install-command";

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

const stackItems = [
  {
    label: "Better Auth",
    detail: "session + routes",
    icon: ShieldCheck,
  },
  {
    label: "Stripe",
    detail: "billing + webhooks",
    icon: CreditCard,
  },
  {
    label: "Trigger.dev",
    detail: "jobs + events",
    icon: Workflow,
  },
  {
    label: "Resend",
    detail: "email + templates",
    icon: Mail,
  },
  {
    label: "Prisma",
    detail: "schema + storage",
    icon: Database,
  },
  {
    label: "OpenAPI",
    detail: "schema + clients",
    icon: FileCode2,
  },
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
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  icon?: ReactNode;
  variant?: "primary" | "secondary";
}) {
  const isExternal = href.startsWith("http");

  return (
    <a
      className={cx(
        "inline-flex h-11 min-w-0 items-center justify-center gap-2 border px-5 font-mono text-[11px] font-normal uppercase tracking-normal transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        variant === "primary" && "border-white bg-white text-black hover:bg-white/88",
        variant === "secondary" &&
          "border-white/18 bg-black text-white hover:border-white/42 hover:bg-white/[0.06]",
      )}
      href={href}
    >
      {icon ? (
        <span aria-hidden className="grid size-4 shrink-0 place-items-center">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
      {isExternal ? (
        <ExternalLink aria-hidden className="size-3.5" strokeWidth={1.5} />
      ) : (
        <ArrowRight aria-hidden className="size-3.5" strokeWidth={1.5} />
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

function FarmRuntimeVisual() {
  return (
    <div
      aria-label="A layered monochrome Farm build pipeline connecting source files to routes, server APIs, and deployment output."
      className="farm-runtime-visual farm-line-field relative flex min-h-[430px] items-center justify-center overflow-hidden bg-black sm:min-h-[520px] lg:min-h-[620px]"
      role="img"
    >
      <div aria-hidden className="farm-dot-grid absolute inset-0 opacity-20" />
      <div aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-white/[0.045]" />
      <div aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-white/[0.045]" />

      <span className="absolute right-5 top-5 z-20 border border-white/10 bg-black px-2 py-1 font-mono text-[9px] uppercase tracking-normal text-white/32 sm:right-8 sm:top-8">
        Build pipeline / 01
      </span>

      <div aria-hidden className="farm-prism-scene z-10">
        <span className="farm-prism-node farm-prism-node-tsx">
          TSX
          <small>routes</small>
        </span>
        <span className="farm-prism-node farm-prism-node-api">
          API
          <small>typed</small>
        </span>
        <span className="farm-prism-node farm-prism-node-mdx">
          MDX
          <small>docs</small>
        </span>
        <span className="farm-prism-node farm-prism-node-edge">
          Edge
          <small>deploy</small>
        </span>

        <div className="farm-prism-stack">
          <div className="farm-prism-plane farm-prism-plane-source" />
          <div className="farm-prism-plane farm-prism-plane-router" />
          <div className="farm-prism-plane farm-prism-plane-runtime" />
          <div className="farm-prism-plane farm-prism-plane-output" />

          <span className="absolute left-1/2 top-[13%] -translate-x-1/2 font-mono text-[8px] uppercase tracking-normal text-white/24">
            Source modules
          </span>
          <span className="absolute left-1/2 top-[33%] -translate-x-1/2 font-mono text-[8px] uppercase tracking-normal text-white/34">
            Route graph
          </span>
          <span className="absolute left-1/2 top-[75%] -translate-x-1/2 font-mono text-[8px] uppercase tracking-normal text-white/32">
            Production output
          </span>

          <div className="farm-prism-mark">
            <FarmMark className="size-16" />
          </div>
        </div>
      </div>

      <div className="absolute bottom-5 left-5 z-20 flex items-center gap-2 font-mono text-[10px] tracking-normal text-white/34 sm:bottom-8 sm:left-8">
        <span className="size-1.5 bg-white" /> 24 routes / 12 APIs / ready
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="farm-full-rule grid w-full lg:grid-cols-[1.08fr_0.92fr]">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-px -top-px z-30 size-[9px] border-l border-t border-white/28"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-px -right-px z-30 size-[9px] border-b border-r border-white/28"
      />
      <div className="flex min-h-[600px] flex-col justify-between gap-14 p-6 sm:p-10 lg:min-h-[620px] lg:p-12">
        <div className="max-w-[38rem]">
          <div className="text-white/42">
            <IndexedLabel icon={Route} index="00" label="React 19 / TypeScript / Universal" />
          </div>
          <HeroTitleFrame>
            <h1 className="max-w-[16ch] text-[2.375rem] font-medium leading-[1.02] tracking-normal text-white sm:text-[3.5rem] lg:text-[2.75rem] min-[1120px]:text-[3.25rem] xl:text-[4rem]">
              <span className="block">React Framework</span>
              <span className="block text-white/82">for Product Apps</span>
            </h1>
          </HeroTitleFrame>
          <p className="mt-6 max-w-[32rem] text-sm leading-6 text-white/56 sm:text-[15px] sm:leading-6">
            Farm.js keeps the app router you already know, then brings typed APIs, middleware,
            integrations, docs, and deployment into the same framework.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink
              href="/docs/getting-started"
              icon={<BookOpen aria-hidden className="size-4" strokeWidth={1.5} />}
            >
              Get Started
            </ButtonLink>
            <ButtonLink
              href="https://github.com/Kinfe123/farm.js"
              icon={<GithubIcon className="size-4" />}
              variant="secondary"
            >
              View on GitHub
            </ButtonLink>
          </div>
        </div>

        <InstallCommand />
      </div>
      <div className="border-t border-white/12 lg:border-l lg:border-t-0">
        <FarmRuntimeVisual />
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

function HeadingSection({
  index,
  eyebrow,
  icon,
  title,
  body,
}: {
  index: string;
  eyebrow: string;
  icon: LucideIcon;
  title: string;
  body?: string;
}) {
  return (
    <section className="farm-wide-rule grid min-h-[320px] w-full lg:grid-cols-[14rem_1fr]">
      <div className="flex items-start border-b border-white/12 p-6 text-white/36 lg:border-b-0 lg:border-r sm:p-8">
        <IndexedLabel icon={icon} index={index} label={eyebrow} />
      </div>
      <div className="flex items-center px-6 py-16 sm:px-10 lg:px-14 lg:py-20">
        <div className="max-w-4xl">
          <h2 className="max-w-[18ch] text-balance text-4xl font-medium leading-[1.04] tracking-normal text-white sm:text-5xl lg:text-[3.5rem]">
            {title}
          </h2>
          {body ? <p className="mt-6 max-w-2xl text-base leading-7 text-white/46">{body}</p> : null}
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

function StackMap() {
  const integrationRows = [
    [
      {
        key: "auth",
        label: "Better Auth",
        detail: "session + routes",
        icon: ShieldCheck,
        className: "flex-[1.1]",
      },
      { key: "blank-1", className: "flex-[0.45]" },
      {
        key: "billing",
        label: "Stripe",
        detail: "billing + webhooks",
        icon: CreditCard,
        className: "flex-[0.9]",
      },
    ],
    [
      { key: "blank-2", className: "flex-[0.35]" },
      {
        key: "database",
        label: "Prisma",
        detail: "schema + storage",
        icon: Database,
        className: "flex-1",
      },
      {
        key: "config",
        label: "farm.config.ts",
        detail: "integration registry",
        icon: Settings2,
        className: "flex-[1.15]",
        featured: true,
      },
      { key: "blank-3", className: "flex-[0.4]" },
    ],
    [
      {
        key: "jobs",
        label: "Trigger.dev",
        detail: "jobs + events",
        icon: Workflow,
        className: "flex-1",
      },
      {
        key: "email",
        label: "Resend",
        detail: "email + templates",
        icon: Mail,
        className: "flex-[0.9]",
      },
      { key: "blank-4", className: "flex-[0.5]" },
      {
        key: "openapi",
        label: "OpenAPI",
        detail: "schema + clients",
        icon: FileCode2,
        className: "flex-1",
      },
    ],
    [
      { key: "blank-5", className: "flex-[0.55]" },
      {
        key: "docs",
        label: "Docs registry",
        detail: "MDX + references",
        icon: BookOpenText,
        className: "flex-1",
      },
      {
        key: "routes",
        label: "Route manifest",
        detail: "pages + APIs",
        icon: Route,
        className: "flex-1",
      },
      { key: "blank-6", className: "flex-[0.35]" },
    ],
  ] as const;

  return (
    <section className="farm-full-rule farm-feature-spotlight group w-full">
      <div className="relative z-10 grid gap-2 p-5 sm:hidden">
        <div className="mb-3 border border-white/24 bg-black p-4 text-center">
          <Settings2 aria-hidden className="mx-auto size-4 text-white/68" strokeWidth={1.5} />
          <p className="mt-3 font-mono text-xs text-white">farm.config.ts</p>
          <p className="mt-1 text-xs text-white/38">one framework contract</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {stackItems.map((item) => {
            const Icon = item.icon;

            return (
              <div key={item.label} className="border border-white/10 bg-black p-3">
                <div className="flex items-center gap-2">
                  <Icon aria-hidden className="size-3.5 text-white/56" strokeWidth={1.5} />
                  <p className="font-mono text-[11px] font-normal uppercase text-white/78">
                    {item.label}
                  </p>
                </div>
                <p className="mt-2 font-mono text-[9px] text-white/32">{item.detail}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative z-10 hidden h-[520px] items-center overflow-hidden sm:flex">
        <div className="mx-auto grid w-full max-w-6xl gap-2 px-6 transition-transform duration-500 ease-out lg:translate-x-[7%] lg:px-0 lg:group-hover:translate-x-0 lg:group-hover:scale-[0.98]">
          {integrationRows.map((row, rowIndex) => (
            <div key={rowIndex} className="flex w-full gap-2">
              {row.map((cell) => {
                if (!("label" in cell)) {
                  return (
                    <div
                      key={cell.key}
                      aria-hidden
                      className={cx(
                        "h-16 min-w-14 border border-white/[0.055] bg-black/70",
                        cell.className,
                      )}
                    />
                  );
                }

                const Icon = cell.icon;
                const isFeatured = "featured" in cell && cell.featured;

                return (
                  <div
                    key={cell.key}
                    className={cx(
                      "flex h-16 min-w-0 items-center border px-4",
                      cell.className,
                      isFeatured
                        ? "border-white bg-white text-black"
                        : "border-white/10 bg-black text-white",
                    )}
                  >
                    <Icon
                      aria-hidden
                      className={cx(
                        "size-4 shrink-0",
                        isFeatured ? "text-black/68" : "text-white/48",
                      )}
                      strokeWidth={1.5}
                    />
                    <div className="ml-3 min-w-0">
                      <p className="truncate font-mono text-[10px] font-normal uppercase tracking-normal">
                        {cell.label}
                      </p>
                      <p
                        className={cx(
                          "mt-1 truncate font-mono text-[9px] tracking-normal",
                          isFeatured ? "text-black/48" : "text-white/28",
                        )}
                      >
                        {cell.detail}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
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
            <HeadingSection
              body="Framework integrations can register routes, server APIs, docs, generated clients, and lifecycle hooks together."
              eyebrow="Product systems"
              icon={ServerCog}
              index="03"
              title="Bring your product stack with you"
            />
            <StackMap />
            <FinalCta />
          </main>
          <Footer />
        </div>
        <div aria-hidden className="farm-page-rail" />
      </div>
    </div>
  );
}
