import type { PageProps } from "@farmjs/core";
import type { ReactNode } from "react";

export const metadata = {
  title: "Farm.js - React framework for product apps",
  description:
    "Farm.js is a React framework for product apps with app routing, typed APIs, middleware, integrations, docs, migrations, and production deployment.",
};

const navItems = [
  { label: "Platform", href: "#platform" },
  { label: "Runtime", href: "#runtime" },
  { label: "Migrate", href: "#migrate" },
  { label: "Docs", href: "/docs" },
] as const;

const sourcePrimitives = [
  "Trigger.dev side menu",
  "Trigger.dev compact table",
  "Trigger.dev code chrome",
  "Infisical cards",
  "Infisical buttons",
  "Infisical nav header",
] as const;

const sideSections = [
  {
    label: "Application",
    items: [
      { name: "Overview", meta: "prod", active: true },
      { name: "Routes", meta: "44" },
      { name: "API handlers", meta: "12" },
      { name: "Middleware", meta: "6" },
    ],
  },
  {
    label: "Product systems",
    items: [
      { name: "Auth", meta: "better-auth" },
      { name: "Billing", meta: "stripe" },
      { name: "Jobs", meta: "trigger.dev" },
      { name: "Docs", meta: "mdx" },
    ],
  },
] as const;

const runtimeRows = [
  ["route", "src/app/dashboard/page.tsx", "typed link", "ready"],
  ["api", "src/app/api/users/route.ts", "client", "ready"],
  ["middleware", "/dashboard/:path*", "auth gate", "matched"],
  ["integration", "better-auth", "session ctx", "loaded"],
  ["integration", "trigger.dev", "jobs client", "loaded"],
  ["deploy", "vercel output", "manifest", "ready"],
] as const;

const eventRows = [
  ["12:04:41", "middleware.start", "/dashboard/settings"],
  ["12:04:41", "middleware.shortCircuit", "/sign-in"],
  ["12:04:42", "route.render", "src/app/dashboard"],
  ["12:04:43", "cache.tag", "team:acme"],
] as const;

const platformModules = [
  {
    label: "Framework",
    title: "App routing that stays familiar",
    body: "Pages, layouts, loading states, route handlers, params, and typed navigation live in src/app without inventing a new mental model.",
    href: "/docs/routing",
  },
  {
    label: "Runtime",
    title: "Middleware as deployable behavior",
    body: "Config middleware and file middleware are discovered, tested, built, and served the same way in production.",
    href: "/docs/middleware",
  },
  {
    label: "Product",
    title: "Integrations with real contracts",
    body: "Auth, billing, jobs, email, storage, and API systems register routes, generated clients, docs, and lifecycle hooks.",
    href: "/docs/integrations",
  },
  {
    label: "Operations",
    title: "Docs, migrations, and deploy output",
    body: "Human docs, OpenAPI surfaces, migration reports, middleware manifests, and platform targets stay reviewable from source.",
    href: "/docs/deployment",
  },
] as const;

const workflowSteps = [
  [
    "01",
    "Create",
    "pnpm create farm@latest",
    "Start from the app router shape teams already know.",
  ],
  [
    "02",
    "Register",
    "defineFarmConfig({ integrations })",
    "Move product systems into framework-level contracts.",
  ],
  [
    "03",
    "Build",
    "farm build --target vercel",
    "Ship routes, middleware, docs, and generated clients together.",
  ],
] as const;

const migrationRows = [
  ["Next App Router", "src/app stays src/app"],
  ["Remix routes", "file routes map into route segments"],
  ["Express APIs", "handlers become typed route APIs"],
  ["manual middleware", "config and file middleware get manifests"],
] as const;

const codeSample = `import { defineFarmConfig } from "@farmjs/core";
import { betterAuth } from "@farmjs/better-auth";
import { triggerDev } from "@farmjs/trigger";

export default defineFarmConfig({
  middleware: [
    {
      matcher: "/dashboard/:path*",
      handler(ctx) {
        if (!ctx.session) {
          return Response.redirect(new URL("/sign-in", ctx.url));
        }
      },
    },
  ],
  integrations: [betterAuth(), triggerDev()],
});`;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Arrow() {
  return (
    <span aria-hidden className="font-mono text-xs">
      -&gt;
    </span>
  );
}

function Wordmark() {
  return (
    <a className="flex items-center gap-2 text-sm font-semibold text-white" href="/">
      <span className="grid size-7 place-items-center rounded-md border border-white bg-white font-mono text-[12px] font-black leading-none text-black">
        F
      </span>
      <span>Farm.js</span>
    </a>
  );
}

function Badge({
  children,
  tone = "dark",
  className,
}: {
  children: ReactNode;
  tone?: "dark" | "light" | "solid";
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-[18px] max-w-full items-center rounded-sm border px-1.5 font-mono text-[10px] font-medium uppercase leading-none whitespace-nowrap",
        tone === "solid" && "border-white bg-white text-black",
        tone === "dark" && "border-white/15 bg-white/[0.035] text-white/60",
        tone === "light" && "border-black/10 bg-black/[0.035] text-black/60",
        className,
      )}
    >
      {children}
    </span>
  );
}

function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <a
      className={cx(
        "group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[5px] border px-4 text-sm font-semibold transition-all duration-150 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70",
        variant === "primary" && "border-white bg-white text-black hover:bg-white/90",
        variant === "secondary" &&
          "border-white/15 bg-white/[0.035] text-white hover:border-white/30 hover:bg-white/[0.06]",
        variant === "ghost" &&
          "border-transparent bg-transparent text-white/70 hover:bg-white/[0.06] hover:text-white",
      )}
      href={href}
    >
      {children}
      <Arrow />
    </a>
  );
}

function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 w-screen max-w-[100vw] border-b border-white/10 bg-black/90 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center justify-between px-4 sm:px-6">
        <Wordmark />

        <nav className="hidden items-center gap-6 md:flex">
          {navItems.map((item) => (
            <a
              key={item.label}
              className="text-xs font-medium text-white/50 transition hover:text-white"
              href={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            className="hidden h-8 items-center rounded-[5px] border border-white/15 px-3 text-xs font-semibold text-white/70 transition hover:border-white/30 hover:text-white sm:inline-flex"
            href="https://github.com/Kinfe123/farm.js"
          >
            GitHub
          </a>
          <a
            className="inline-flex h-8 items-center rounded-[5px] bg-white px-3 text-xs font-bold text-black transition hover:bg-white/90"
            href="/docs/getting-started"
          >
            Start
          </a>
        </div>
      </div>
    </header>
  );
}

function SectionHeader({
  eyebrow,
  title,
  body,
  tone = "dark",
}: {
  eyebrow: string;
  title: string;
  body: string;
  tone?: "dark" | "light";
}) {
  return (
    <div className="max-w-2xl">
      <Badge tone={tone === "dark" ? "dark" : "light"}>{eyebrow}</Badge>
      <h2
        className={cx(
          "mt-5 text-3xl font-semibold leading-[1.02] tracking-normal sm:text-5xl",
          tone === "dark" ? "text-white" : "text-black",
        )}
      >
        {title}
      </h2>
      <p
        className={cx(
          "mt-4 text-sm leading-6",
          tone === "dark" ? "text-white/60" : "text-black/60",
        )}
      >
        {body}
      </p>
    </div>
  );
}

function SourceStrip() {
  return (
    <div className="mx-auto max-w-[1180px] border-x border-white/10 px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="font-mono text-[11px] uppercase text-white/40">public repo component map</p>
        <div className="flex flex-wrap gap-2">
          {sourcePrimitives.map((item) => (
            <Badge key={item}>{item}</Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

function SideMenuPreview() {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-white/10 bg-white/[0.025] md:w-[220px] md:border-r md:border-b-0">
      <div className="border-b border-white/10 p-3">
        <div className="flex items-center gap-2 rounded-md border border-white/[0.09] bg-black p-2.5">
          <span className="grid size-7 place-items-center rounded-md bg-white text-xs font-black text-black">
            A
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">acme-web</p>
            <p className="font-mono text-[10px] uppercase text-white/40">production</p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-3">
        {sideSections.map((section) => (
          <div key={section.label}>
            <p className="mb-2 px-1 font-mono text-[10px] uppercase text-white/30">
              {section.label}
            </p>
            <div className="space-y-1">
              {section.items.map((item) => (
                <a
                  key={item.name}
                  className={cx(
                    "group flex h-8 items-center justify-between gap-3 overflow-hidden rounded px-2 text-sm transition",
                    item.active
                      ? "bg-white text-black"
                      : "text-white/60 hover:bg-white/[0.055] hover:text-white",
                  )}
                  href="/docs"
                >
                  <span className="truncate font-medium">{item.name}</span>
                  <span
                    className={cx(
                      "shrink-0 font-mono text-[10px]",
                      item.active ? "text-black/50" : "text-white/30 group-hover:text-white/50",
                    )}
                  >
                    {item.meta}
                  </span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto border-t border-white/10 p-3">
        <div className="rounded-md border border-white/[0.09] bg-white/[0.035] p-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase text-white/40">status</p>
            <Badge>live</Badge>
          </div>
          <p className="mt-3 text-xs leading-5 text-white/50">
            Build output, docs, and middleware manifest are in sync.
          </p>
        </div>
      </div>
    </aside>
  );
}

function RuntimeTable() {
  return (
    <div className="overflow-x-auto rounded-md border border-white/[0.09] bg-black">
      <table className="w-full min-w-[640px] whitespace-nowrap text-left">
        <thead className="bg-white/[0.045] text-white">
          <tr className="border-b border-white/[0.09]">
            {["Type", "Source", "Contract", "State"].map((heading) => (
              <th
                key={heading}
                className="px-3 py-2 font-mono text-[11px] font-medium uppercase text-white/40"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runtimeRows.map(([type, source, contract, state]) => (
            <tr
              key={`${type}-${source}`}
              className="group border-b border-white/[0.07] last:border-b-0 hover:bg-white/[0.035]"
            >
              <td className="px-3 py-3 font-mono text-[11px] text-white/70">{type}</td>
              <td className="max-w-[260px] truncate px-3 py-3 font-mono text-[11px] text-white/50">
                {source}
              </td>
              <td className="px-3 py-3 font-mono text-[11px] text-white/50">{contract}</td>
              <td className="px-3 py-3">
                <Badge className="group-hover:border-white/25">{state}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeChrome() {
  const lines = codeSample.split("\n");

  return (
    <div className="overflow-hidden rounded-md border border-white/[0.09] bg-black">
      <div className="flex h-10 items-center justify-between border-b border-white/[0.09] bg-white/[0.035] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 rounded-full border border-white/50" />
          <span className="size-2 rounded-full border border-white/30" />
          <span className="size-2 rounded-full border border-white/20" />
          <p className="ml-1 truncate font-mono text-[11px] text-white/50">farm.config.ts</p>
        </div>
        <button className="h-6 rounded-sm border border-white/10 px-2 font-mono text-[10px] uppercase text-white/60 transition hover:border-white/30 hover:text-white">
          Copy
        </button>
      </div>
      <pre className="max-h-[320px] overflow-auto p-0 text-[12px] leading-6">
        <code>
          {lines.map((line, index) => (
            <span
              key={`${index}-${line}`}
              className={cx(
                "grid grid-cols-[2.25rem_minmax(0,1fr)] px-3 font-mono",
                index >= 6 && index <= 13 ? "bg-white/[0.035] text-white/80" : "text-white/60",
              )}
            >
              <span className="select-none pr-3 text-right text-white/20">{index + 1}</span>
              <span className="whitespace-pre">{line || " "}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function EventStream() {
  return (
    <div className="rounded-md border border-white/[0.09] bg-white/[0.03]">
      <div className="flex items-center justify-between border-b border-white/[0.09] px-3 py-2">
        <p className="font-mono text-[11px] uppercase text-white/40">observability</p>
        <Badge>events</Badge>
      </div>
      <div>
        {eventRows.map(([time, event, route]) => (
          <div
            key={`${time}-${event}`}
            className="grid grid-cols-[72px_1fr] gap-3 border-b border-white/[0.06] px-3 py-2.5 last:border-b-0"
          >
            <span className="font-mono text-[11px] text-white/30">{time}</span>
            <div className="min-w-0">
              <p className="truncate font-mono text-[11px] text-white/70">{event}</p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-white/40">{route}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="rounded-md border border-white/[0.09] bg-white/[0.03] p-3">
      <p className="font-mono text-[10px] uppercase text-white/40">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-normal text-white">{value}</p>
      <p className="mt-1 text-xs leading-5 text-white/50">{caption}</p>
    </div>
  );
}

function AppPreview() {
  return (
    <div className="mx-auto mt-12 w-full min-w-0 max-w-[1180px] rounded-[12px] border border-white/10 bg-black p-1 shadow-[0_50px_150px_rgba(0,0,0,0.88)]">
      <div className="min-w-0 overflow-hidden rounded-[9px] border border-white/[0.08] bg-black">
        <div className="flex h-11 items-center justify-between border-b border-white/10 px-4">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full border border-white/50" />
            <span className="size-2.5 rounded-full border border-white/30" />
            <span className="size-2.5 rounded-full border border-white/20" />
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Badge>farm runtime</Badge>
            <Badge>production</Badge>
          </div>
          <p className="font-mono text-[11px] text-white/40">localhost:4107</p>
        </div>

        <div className="w-full overflow-x-auto">
          <div className="flex min-h-[650px] min-w-full flex-col md:min-w-[980px] md:flex-row">
            <SideMenuPreview />

            <section className="min-w-0 flex-1">
              <div className="border-b border-white/10 bg-white/[0.018] px-4 py-3">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-mono text-[11px] text-white/40">
                      <span>Acme</span>
                      <span>/</span>
                      <span>Web</span>
                      <span>/</span>
                      <span className="text-white/70">Runtime</span>
                    </div>
                    <h2 className="mt-2 text-xl font-semibold tracking-normal text-white">
                      Product runtime inventory
                    </h2>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button className="h-8 rounded-[5px] border border-white/15 px-3 text-xs font-semibold text-white/70 transition hover:border-white/30 hover:text-white">
                      Dry run
                    </button>
                    <button className="h-8 rounded-[5px] border border-white bg-white px-3 text-xs font-bold text-black transition hover:bg-white/90">
                      Deploy
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {["Runtime", "Middleware", "Integrations", "Docs"].map((tab, index) => (
                    <button
                      key={tab}
                      className={cx(
                        "h-7 rounded-sm border px-2.5 text-xs font-medium transition",
                        index === 0
                          ? "border-white bg-white text-black"
                          : "border-white/10 text-white/50 hover:border-white/25 hover:text-white",
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <MetricCard label="routes" value="44" caption="pages, layouts, and APIs" />
                    <MetricCard label="middleware" value="6" caption="config plus file guards" />
                    <MetricCard label="targets" value="3" caption="vercel, node, preview" />
                  </div>
                  <RuntimeTable />
                </div>

                <div className="space-y-3">
                  <CodeChrome />
                  <EventStream />
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative w-screen max-w-[100vw] overflow-hidden border-b border-white/10 pt-28">
      <div className="absolute inset-0 -z-10 opacity-[0.12] [background-image:linear-gradient(to_right,rgba(255,255,255,0.22)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.16)_1px,transparent_1px)] [background-size:72px_72px]" />
      <div className="mx-auto w-full max-w-[1240px] px-4 pb-16 sm:px-6 sm:pb-24">
        <div className="mx-auto w-full max-w-5xl text-center">
          <a
            className="inline-flex w-full max-w-full items-center justify-center gap-2 overflow-hidden rounded-[5px] border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white/70 transition hover:border-white/30 hover:text-white sm:w-auto"
            href="/docs/middleware"
          >
            <span className="shrink-0 rounded-[3px] bg-white px-1.5 py-0.5 font-mono text-[10px] font-black uppercase text-black">
              New
            </span>
            <span className="block min-w-0 truncate">Production middleware runtime</span>
          </a>

          <h1 className="mx-auto mt-7 max-w-[310px] text-balance text-3xl font-semibold leading-[0.98] tracking-normal text-white sm:max-w-5xl sm:text-7xl sm:leading-[0.94] lg:text-8xl">
            Farm.js is the React framework for product apps.
          </h1>
          <p className="mx-auto mt-6 max-w-[280px] text-sm leading-6 text-white/60 sm:max-w-2xl sm:text-lg sm:leading-8">
            Keep the app router shape, then add the product runtime around it: typed APIs,
            middleware, auth, billing, jobs, docs, migrations, and deploy output in one source tree.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href="/docs/getting-started">Start building</ButtonLink>
            <ButtonLink href="/docs/migrations" variant="secondary">
              Migrate an app
            </ButtonLink>
          </div>
        </div>

        <AppPreview />
      </div>
      <SourceStrip />
    </section>
  );
}

function ModuleCard({
  label,
  title,
  body,
  href,
}: {
  label: string;
  title: string;
  body: string;
  href: string;
}) {
  return (
    <a
      className="group flex min-h-[290px] flex-col border border-black/10 bg-white p-5 transition hover:bg-black/[0.035]"
      href={href}
    >
      <div className="flex items-center justify-between">
        <Badge tone="light">{label}</Badge>
        <span className="font-mono text-[11px] text-black/30 transition group-hover:text-black/60">
          /docs
        </span>
      </div>

      <div className="mt-10 grid h-24 grid-cols-4 overflow-hidden rounded-md border border-black/10 bg-black/[0.035]">
        {Array.from({ length: 16 }).map((_, index) => (
          <span
            key={index}
            className={cx(
              "border-b border-r border-black/[0.08]",
              index % 5 === 0 && "bg-black/[0.055]",
              index === 5 && "bg-black text-white",
            )}
          />
        ))}
      </div>

      <h3 className="mt-8 text-2xl font-semibold leading-tight tracking-normal text-black">
        {title}
      </h3>
      <p className="mt-3 text-sm leading-6 text-black/60">{body}</p>
      <span className="mt-auto inline-flex items-center gap-2 pt-8 text-sm font-semibold text-black">
        Read the docs
        <Arrow />
      </span>
    </a>
  );
}

function PlatformSection() {
  return (
    <section id="platform" className="bg-white py-20 text-black sm:py-28">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeader
            tone="light"
            eyebrow="Platform"
            title="A framework surface for the whole product."
            body="Farm treats framework files and product systems as one inventory so teams can review what the app owns before it ships."
          />
          <a
            className="inline-flex h-10 w-fit items-center gap-2 rounded-[5px] border border-black/15 px-4 text-sm font-semibold text-black transition hover:border-black/30"
            href="/docs"
          >
            Open docs
            <Arrow />
          </a>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-[10px] border border-black/10 bg-black/10 md:grid-cols-2 lg:grid-cols-4">
          {platformModules.map((module) => (
            <ModuleCard key={module.title} {...module} />
          ))}
        </div>
      </div>
    </section>
  );
}

function RuntimeSection() {
  return (
    <section id="runtime" className="border-y border-white/10 py-20 sm:py-28">
      <div className="mx-auto grid max-w-[1180px] gap-10 px-4 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
        <SectionHeader
          eyebrow="Runtime"
          title="The production build gets the same behavior you tested."
          body="Middleware matchers, app middleware files, generated clients, docs routes, and deployment manifests are part of the build contract."
        />

        <div className="overflow-hidden rounded-[10px] border border-white/10 bg-white/[0.025]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <p className="font-mono text-[11px] uppercase text-white/40">runtime contract</p>
            <Badge>stable surface</Badge>
          </div>
          <RuntimeTable />
        </div>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section className="bg-white py-20 text-black sm:py-28">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <SectionHeader
          tone="light"
          eyebrow="Workflow"
          title="A boring path from source tree to deployed app."
          body="Initialize a project, register the product systems, then ship the route tree and runtime assets together."
        />

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {workflowSteps.map(([step, title, command, body]) => (
            <article
              key={step}
              className="rounded-[10px] border border-black/10 bg-black/[0.025] p-5"
            >
              <div className="flex items-center justify-between">
                <Badge tone="light">{step}</Badge>
                <span className="font-mono text-[11px] text-black/40">farm</span>
              </div>
              <h3 className="mt-8 text-2xl font-semibold tracking-normal">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-black/60">{body}</p>
              <p className="mt-6 overflow-hidden rounded-md border border-black/10 bg-white px-3 py-2 font-mono text-[12px] text-black/70">
                {command}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function MigrationSection() {
  return (
    <section id="migrate" className="border-t border-white/10 py-20 sm:py-28">
      <div className="mx-auto grid max-w-[1180px] gap-10 px-4 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
        <SectionHeader
          eyebrow="Migrate"
          title="Bring an existing framework over without a blind rewrite."
          body="The migrator reads framework evidence, maps files into Farm routes, and reports unsupported APIs before it writes."
        />

        <div className="rounded-[10px] border border-white/10 bg-white/[0.025] p-4">
          <CodeChrome />

          <div className="mt-4 overflow-hidden rounded-md border border-white/[0.09]">
            {migrationRows.map(([from, to]) => (
              <div
                key={from}
                className="grid gap-2 border-b border-white/[0.07] px-3 py-3 font-mono text-[11px] last:border-b-0 sm:grid-cols-[1fr_auto_1fr] sm:items-center"
              >
                <span className="min-w-0 truncate text-white/50">{from}</span>
                <span className="hidden text-white/20 sm:block">-&gt;</span>
                <span className="min-w-0 truncate text-white/80">{to}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="bg-white py-16 text-black sm:py-20">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <div className="rounded-[10px] border border-black/10 bg-black p-5 text-white sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <Badge>open source</Badge>
              <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-normal sm:text-5xl">
                Build the product, not the glue.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
                Start with Farm, migrate an existing app, or inspect the runtime contracts from
                source.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <ButtonLink href="/docs/getting-started">Get started</ButtonLink>
              <ButtonLink href="https://github.com/Kinfe123/farm.js" variant="secondary">
                View source
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HomePage(_props: PageProps) {
  return (
    <div className="min-h-screen w-screen max-w-[100vw] overflow-x-hidden bg-black font-sans text-white">
      <Header />
      <main>
        <Hero />
        <PlatformSection />
        <RuntimeSection />
        <WorkflowSection />
        <MigrationSection />
        <FinalCta />
      </main>
    </div>
  );
}
