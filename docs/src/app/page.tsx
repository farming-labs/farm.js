import type { PageProps } from "@farmjs/core";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Blocks,
  BookOpen,
  BookOpenText,
  Braces,
  CreditCard,
  Database,
  ExternalLink,
  FileCode2,
  FileText,
  FolderTree,
  Gauge,
  GitCompareArrows,
  GitFork,
  Layers3,
  Mail,
  Menu,
  Network,
  PanelsTopLeft,
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
import betterAuthIconUrl from "simple-icons/icons/betterauth.svg?url";
import githubIconUrl from "simple-icons/icons/github.svg?url";
import prismaIconUrl from "simple-icons/icons/prisma.svg?url";
import reactIconUrl from "simple-icons/icons/react.svg?url";
import stripeIconUrl from "simple-icons/icons/stripe.svg?url";
import typescriptIconUrl from "simple-icons/icons/typescript.svg?url";
import viteIconUrl from "simple-icons/icons/vite.svg?url";
import nitroIconUrl from "../assets/nitro.svg?url";
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
  { index: "04", label: "Resources", href: "#open-source", icon: FileText },
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
    position: "left-[5%] top-[12%]",
    icon: ShieldCheck,
  },
  {
    label: "Stripe",
    detail: "billing + webhooks",
    position: "right-[5%] top-[12%]",
    icon: CreditCard,
  },
  {
    label: "Trigger.dev",
    detail: "jobs + events",
    position: "left-[3%] bottom-[15%]",
    icon: Workflow,
  },
  {
    label: "Resend",
    detail: "email + templates",
    position: "right-[3%] bottom-[15%]",
    icon: Mail,
  },
  {
    label: "Prisma",
    detail: "schema + storage",
    position: "left-[22%] top-[41%]",
    icon: Database,
  },
  {
    label: "OpenAPI",
    detail: "schema + clients",
    position: "right-[22%] top-[41%]",
    icon: FileCode2,
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
    <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-normal text-current">
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
      <span className="font-mono text-[13px] font-bold uppercase tracking-normal">
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
        "inline-flex h-11 min-w-0 items-center justify-center gap-2 border px-5 font-mono text-[11px] font-semibold uppercase tracking-normal transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
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
      className="farm-announcement flex h-8 items-center justify-center border-b border-white/12 px-4 font-mono text-[10px] font-semibold uppercase tracking-normal text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
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
      <div className="flex h-16 w-full items-stretch">
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
            className="grid size-16 place-items-center border-l border-white/12 text-white/52 transition-colors duration-150 hover:bg-white/[0.035] hover:text-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
            href="https://github.com/Kinfe123/farm.js"
            title="GitHub"
          >
            <GithubIcon className="size-4" />
          </a>
          <a
            className="inline-flex h-16 items-center gap-1.5 border-l border-white/12 bg-white px-5 font-mono text-[10px] font-semibold uppercase tracking-normal text-black transition-colors duration-150 hover:bg-white/88 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
            href="/docs"
          >
            <BookOpenText aria-hidden className="size-3.5" strokeWidth={1.6} />
            Docs
          </a>
        </div>

        <details className="group relative ml-auto border-l border-white/12 lg:hidden">
          <summary className="grid size-16 cursor-pointer list-none place-items-center text-white transition-colors hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
            <span className="sr-only">Open navigation</span>
            <Menu aria-hidden className="size-4 group-open:hidden" strokeWidth={1.5} />
            <X aria-hidden className="hidden size-4 group-open:block" strokeWidth={1.5} />
          </summary>
          <nav
            aria-label="Mobile navigation"
            className="absolute -right-px top-16 w-screen overflow-hidden border border-white/14 bg-black shadow-2xl shadow-black/60"
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
        <div className="max-w-[34rem]">
          <div className="text-white/42">
            <IndexedLabel icon={Route} index="00" label="React 19 / TypeScript / Universal" />
          </div>
          <h1 className="mt-8 max-w-[11ch] text-balance text-5xl font-medium leading-[0.98] tracking-normal text-white sm:text-6xl xl:text-[4.75rem]">
            The React Framework for Product Apps
          </h1>
          <p className="mt-7 max-w-[31rem] text-base leading-7 text-white/58 sm:text-lg sm:leading-8">
            Farm.js keeps the app router you already know, then brings typed APIs, middleware,
            integrations, docs, and deployment into the same framework.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
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
                      "flex h-16 w-40 shrink-0 items-center justify-center gap-3 border-r border-white/12 bg-black px-4 font-mono text-[10px] font-medium uppercase tracking-normal text-white/48 transition-colors duration-150 hover:bg-white/[0.07] hover:text-white/82 sm:w-44 sm:text-[11px]",
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
    <article className={cx("flex min-h-[500px] min-w-0 flex-col justify-between", className)}>
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

function FileTreeVisual() {
  const files = [
    ["src/app", "directory"],
    ["  dashboard/page.tsx", "route"],
    ["  api/users/route.ts", "api"],
    ["  docs/page.md", "content"],
    ["farm.config.ts", "config"],
  ] as const;

  return (
    <div className="farm-feature-spotlight flex h-[340px] items-end justify-end overflow-hidden pl-6 sm:pl-10">
      <div className="relative z-10 -mb-px -mr-px flex h-[290px] w-full max-w-full flex-col overflow-hidden border border-white/10 bg-black shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
        <div className="flex h-10 shrink-0 items-center border-b border-white/8 px-4 font-mono text-[10px] text-white/32">
          project
        </div>
        <div className="min-h-0 flex-1 py-3">
          {files.map(([name, kind]) => (
            <div key={name} className="grid grid-cols-[1fr_auto] px-4 py-2 font-mono text-[11px]">
              <span
                className={
                  kind === "directory" || kind === "config" ? "text-white" : "text-white/58"
                }
              >
                {name}
              </span>
              <span className="text-white/34">{kind}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiddlewareVisual() {
  const events = [
    ["request", "/dashboard/settings", "12:04:41.021"],
    ["matcher", "/dashboard/:path*", "+0.2ms"],
    ["session", "authenticated", "+1.6ms"],
    ["render", "dashboard/settings", "+8.4ms"],
  ] as const;

  return (
    <div className="farm-feature-spotlight flex h-[340px] items-end justify-end overflow-hidden pl-6 sm:pl-10">
      <div className="relative z-10 -mb-px -mr-px grid h-[290px] w-full max-w-full grid-rows-4 overflow-hidden border border-white/10 bg-black shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
        {events.map(([event, detail, time], index) => (
          <div
            key={event}
            className={cx(
              "grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 font-mono text-[10px]",
              index !== 0 && "border-t border-white/8",
            )}
          >
            <span className="text-white/72">{event}</span>
            <span className="truncate text-white/54">{detail}</span>
            <span className="text-white/25">{time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocsVisual() {
  return (
    <div className="farm-feature-spotlight flex h-[340px] items-end justify-end overflow-hidden pl-6 sm:pl-10">
      <div className="relative z-10 -mb-px -mr-px grid h-[290px] w-full max-w-full grid-cols-[7rem_1fr] overflow-hidden border border-white/10 bg-black shadow-[0_18px_50px_rgba(0,0,0,0.18)] sm:grid-cols-[9rem_1fr]">
        <div className="border-r border-white/10 p-3 font-mono text-[9px] text-white/34">
          <p className="text-white/70">Introduction</p>
          <p className="mt-3">Routing</p>
          <p className="mt-3">API client</p>
          <p className="mt-3">Middleware</p>
          <p className="mt-3">Deployment</p>
        </div>
        <div className="p-5">
          <span className="font-mono text-[9px] text-white/52">GETTING STARTED</span>
          <div className="mt-4 h-4 w-3/4 bg-white/80" />
          <div className="mt-4 h-2 w-full bg-white/12" />
          <div className="mt-2 h-2 w-5/6 bg-white/12" />
          <div className="mt-5 border border-white/10 bg-black p-3 font-mono text-[9px] text-white/55">
            pnpm create farm@latest
          </div>
        </div>
      </div>
    </div>
  );
}

function MigrationVisual() {
  const rows = [
    ["Next.js", "src/app preserved", "ready"],
    ["Remix", "routes mapped", "ready"],
    ["Express", "handlers inventoried", "ready"],
  ] as const;

  return (
    <div className="farm-feature-spotlight flex h-[340px] items-end justify-end overflow-hidden pl-6 sm:pl-10">
      <div className="relative z-10 -mb-px -mr-px flex h-[290px] w-full max-w-full flex-col overflow-hidden border border-white/10 bg-black p-4 shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
        <p className="font-mono text-[10px] text-white/32">migration.report.json</p>
        <div className="mt-4 grid min-h-0 flex-1 grid-rows-3 gap-2">
          {rows.map(([source, detail, status]) => (
            <div
              key={source}
              className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 border border-white/8 px-3 py-2 font-mono text-[9px] sm:text-[10px]"
            >
              <span className="text-white">{source}</span>
              <span className="truncate text-white/42">{detail}</span>
              <span className="text-white/68">{status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FoundationGrid() {
  return (
    <section className="farm-full-rule grid w-full lg:grid-cols-2">
      <FeatureCell
        body="Pages, layouts, route handlers, loading states, markdown, and typed links live in the app directory."
        icon={FolderTree}
        index="02.1"
        title="A Familiar App Router"
      >
        <FileTreeVisual />
      </FeatureCell>
      <FeatureCell
        body="Config and file middleware are discovered, traced, tested, and compiled into deployment matchers."
        className="border-t border-white/12 lg:border-l lg:border-t-0"
        icon={Network}
        index="02.2"
        title="Middleware You Can See"
      >
        <MiddlewareVisual />
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

function StackMap() {
  return (
    <section className="farm-full-rule farm-stack-map w-full">
      <div className="grid gap-2 p-5 sm:hidden">
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
                  <p className="font-mono text-[11px] font-medium uppercase text-white/78">
                    {item.label}
                  </p>
                </div>
                <p className="mt-2 font-mono text-[9px] text-white/32">{item.detail}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative hidden h-[520px] overflow-hidden sm:block">
        <svg aria-hidden className="absolute inset-0 size-full" viewBox="0 0 1240 520">
          <g fill="none" stroke="white" strokeDasharray="4 9" strokeOpacity="0.2" strokeWidth="1.3">
            <path d="M620 260 170 86" />
            <path d="M620 260 1070 86" />
            <path d="M620 260 160 430" />
            <path d="M620 260 1080 430" />
            <path d="M620 260 360 250" />
            <path d="M620 260 880 250" />
          </g>
        </svg>

        <div className="absolute left-1/2 top-1/2 w-56 -translate-x-1/2 -translate-y-1/2 border border-white/28 bg-black p-5 text-center shadow-[0_0_50px_rgba(255,255,255,0.04)]">
          <FarmMark className="mx-auto size-8 text-white" />
          <div className="mt-3 flex items-center justify-center gap-2">
            <Settings2 aria-hidden className="size-3.5 text-white/58" strokeWidth={1.5} />
            <p className="font-mono text-sm text-white">farm.config.ts</p>
          </div>
          <p className="mt-2 text-xs leading-5 text-white/38">
            one contract for routes, server APIs, docs, and lifecycle hooks
          </p>
        </div>

        {stackItems.map((item) => {
          const Icon = item.icon;

          return (
            <div
              key={item.label}
              className={cx("absolute w-40 border border-white/12 bg-black p-4", item.position)}
            >
              <div className="flex items-center gap-2">
                <Icon aria-hidden className="size-3.5 text-white/52" strokeWidth={1.5} />
                <p className="font-mono text-[11px] font-medium uppercase text-white/78">
                  {item.label}
                </p>
              </div>
              <p className="mt-2 font-mono text-[9px] text-white/32">{item.detail}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OpenSourceSection() {
  const links = [
    {
      label: "Framework source",
      body: "Read the router, runtime, build, and deployment implementation in the public repository.",
      href: "https://github.com/Kinfe123/farm.js",
      meta: "packages/farm",
      icon: GithubIcon,
    },
    {
      label: "Integration SDK",
      body: "Build auth, billing, jobs, storage, and product-system contracts as first-class integrations.",
      href: "/docs/plugins/create-plugin",
      meta: "create a plugin",
      icon: Plug,
    },
    {
      label: "Migration tooling",
      body: "Inspect a current application and produce a reviewable migration inventory before rewriting it.",
      href: "/docs/migrations",
      meta: "farm migrate",
      icon: GitCompareArrows,
    },
  ] as const;

  const stats = [
    { value: "MIT", label: "licensed", icon: BadgeCheck },
    { value: "19", label: "React", brand: reactIconUrl },
    { value: "TS", label: "first", brand: typescriptIconUrl },
  ] as const;

  return (
    <section id="open-source" className="farm-full-rule w-full">
      <div className="grid gap-12 px-6 py-20 sm:px-10 lg:grid-cols-[1fr_auto] lg:items-end lg:px-14 lg:py-28">
        <div className="max-w-2xl">
          <div className="text-white/45">
            <IndexedLabel icon={GitFork} index="04" label="Open source / MIT" />
          </div>
          <h2 className="mt-5 text-balance text-4xl font-medium leading-[1.04] tracking-normal text-white sm:text-5xl">
            Built in public for the React ecosystem
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-white/48">
            The framework, integration contracts, migration tooling, and documentation are all
            reviewable source.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-6 sm:gap-10">
          {stats.map((stat) => {
            const Icon = "icon" in stat ? stat.icon : null;

            return (
              <div key={stat.label}>
                <span className="mb-4 grid size-8 place-items-center border border-white/12 text-white/54">
                  {"brand" in stat ? (
                    <BrandIcon className="size-3.5" src={stat.brand} />
                  ) : Icon ? (
                    <Icon aria-hidden className="size-4" strokeWidth={1.5} />
                  ) : null}
                </span>
                <p className="font-mono text-2xl font-medium text-white sm:text-3xl">
                  {stat.value}
                </p>
                <p className="mt-2 font-mono text-[10px] uppercase text-white/35">{stat.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid border-t border-white/12 md:grid-cols-3">
        {links.map((item, index) => (
          <a
            key={item.label}
            className={cx(
              "group flex min-h-[250px] flex-col justify-between p-6 transition-colors duration-150 hover:bg-white/[0.035] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white sm:p-8",
              index !== 0 && "border-t border-white/12 md:border-l md:border-t-0",
            )}
            href={item.href}
          >
            <div>
              <div className="-mx-6 flex items-center justify-between border-b border-white/10 px-6 pb-5 sm:-mx-8 sm:px-8">
                <span className="grid size-9 place-items-center border border-white/14 text-white/68">
                  <item.icon className="size-4" />
                </span>
                <p className="font-mono text-[10px] uppercase text-white/38">{item.meta}</p>
              </div>
              <h3 className="mt-6 font-mono text-sm font-semibold uppercase text-white">
                {item.label}
              </h3>
              <p className="mt-3 text-sm leading-6 text-white/45">{item.body}</p>
            </div>
            <span className="mt-8 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-normal text-white/60 transition-colors duration-150 group-hover:text-white">
              Explore
              {item.href.startsWith("http") ? (
                <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={1.5} />
              ) : (
                <ArrowRight aria-hidden className="size-3.5" strokeWidth={1.5} />
              )}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="farm-full-rule farm-footer-field flex min-h-[520px] w-full items-center justify-center px-6 py-20 text-center sm:px-10">
      <div className="max-w-3xl">
        <span className="mx-auto grid size-14 place-items-center border border-white/18 bg-white text-black">
          <FarmMark className="size-8" />
        </span>
        <h2 className="mt-8 text-balance text-4xl font-medium leading-[1.02] tracking-normal text-white sm:text-6xl">
          Start building with Farm.js
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-white/48">
          Build the product in one source tree, from the first route to production output.
        </p>
        <div className="mt-9 flex justify-center">
          <ButtonLink
            href="/docs/getting-started"
            icon={<Rocket aria-hidden className="size-4" strokeWidth={1.5} />}
          >
            Get Started
          </ButtonLink>
        </div>
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
            <HeadingSection
              body="Farm keeps the app loop fast while giving the framework a complete view of what the product owns."
              eyebrow="Developer experience"
              icon={Gauge}
              index="01"
              title="A better developer experience, from route to runtime"
            />
            <DeveloperExperienceGrid />
            <HeadingSection
              body="The familiar app directory stays simple. Farm composes the product systems around it."
              eyebrow="Application foundation"
              icon={PanelsTopLeft}
              index="02"
              title="A shared foundation for the whole application"
            />
            <FoundationGrid />
            <HeadingSection
              body="Framework integrations can register routes, server APIs, docs, generated clients, and lifecycle hooks together."
              eyebrow="Product systems"
              icon={ServerCog}
              index="03"
              title="Bring your product stack with you"
            />
            <StackMap />
            <OpenSourceSection />
            <FinalCta />
          </main>
          <Footer />
        </div>
        <div aria-hidden className="farm-page-rail" />
      </div>
    </div>
  );
}
