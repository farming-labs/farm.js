import type { PageProps } from "@farmjs/core";
import { ConsoleAscii } from "../components/console-ascii";
import { DitherShader } from "../components/ui/dither-shader";
import { featuredDocPages } from "../lib/docs";

export const metadata = {
  title: "farmjs.dev - React framework for integrated apps",
  description:
    "Farm.js is the comprehensive JavaScript framework for shipping full products with React, with auth, data, billing, and deployment working as one system.",
};

const asciiRows = [
  "              . .     . .       . .     .     . .             . .       . .     . .       . .       . .     .",
  "     . . .     ? ?   .   + +       . .   ? ?     . .     + +       . .     ? ?       . .       + +     . .",
  "   . . ? ? + + # #   . . ? ? + +   . .   # #   ? ? + +   . .   @ @   . .   + +   ? ?   . .   # #   . .",
  " . . + + ? ? # # @ @ . . + + ? ? # #   . . + + ? ? # #   . . @ @ # #   . . + + ? ? # #   . . @ @",
  "? ? + + # # @ @ $ $ ? ? + + # # @ @   ? ? + + # # @ @   ? ? # # @ @ $ $   ? ? + + # # @ @   ? ?",
  "+ + # # @ @ $ $ % % + + # # @ @ $ $   + + # # @ @ $ $   + + @ @ $ $ % %   + + # # @ @ $ $   + +",
  "# # @ @ $ $ % % S S # # @ @ $ $ % %   # # @ @ $ $ % %   # # $ $ % % S S   # # @ @ $ $ % %   # #",
  "@ @ $ $ % % S S ? ? @ @ $ $ % % S S   @ @ $ $ % % S S   @ @ % % S S ? ?   @ @ $ $ % % S S   @ @",
  "$ $ % % S S ? ? + + $ $ % % S S ? ?   $ $ % % S S ? ?   $ $ S S ? ? + +   $ $ % % S S ? ?   $ $",
  "% % S S ? ? + + # # % % S S ? ? + +   % % S S ? ? + +   % % ? ? + + # #   % % S S ? ? + +   % %",
  "S S ? ? + + # # @ @ S S ? ? + + # #   S S ? ? + + # #   S S + + # # @ @   S S ? ? + + # #   S S",
  "? ? + + # # @ @ $ $ ? ? + + # # @ @   ? ? + + # # @ @   ? ? # # @ @ $ $   ? ? + + # # @ @   ? ?",
  "+ + # # @ @ $ $ % % + + # # @ @ $ $   + + # # @ @ $ $   + + @ @ $ $ % %   + + # # @ @ $ $   + +",
  "# # @ @ $ $ % % S S # # @ @ $ $ % %   # # @ @ $ $ % %   # # $ $ % % S S   # # @ @ $ $ % %   # #",
  "@ @ $ $ % % S S @ @ @ @ $ $ % % S S   @ @ $ $ % % S S   @ @ % % S S @ @   @ @ $ $ % % S S   @ @",
];

const asciiField = asciiRows.map((row) => `${row}     ${row}`).join("\n");
const heroGridCells = Array.from({ length: 8 }, (_, index) => index);
const productPillars = [
  {
    title: "App Router Familiarity",
    body: "Use pages, layouts, route boundaries, typed links, API routes, and route-level rendering exports in a Next-inspired app model.",
  },
  {
    title: "Integration Native",
    body: "Auth, billing, email, jobs, AI, API keys, webhooks, providers, and typed server/browser callers share one integration contract.",
  },
  {
    title: "Runtime Control",
    body: "Cache, PPR, markdown mirrors, docs routes, OpenAPI, storage clients, middleware, plugins, and deployment targets live in Farm config.",
  },
] as const;

const frameworkFeatures = [
  "File-based routing and nested layouts",
  "Typed Link hrefs from generated route types",
  "API routes with zod or standard-schema validation",
  "api.hello.get style generated callers",
  "Integration-owned routes and server/client APIs",
  "Storage and ORM access for integration schemas",
  "PPR shell caching and shared revalidation",
  "Runtime events for cache, PPR, routes, API, storage, builds",
  "Docs engine, markdown mirrors, and OpenAPI reference",
  "Deployment targets for Vercel, Cloudflare, Netlify, and Node",
] as const;

const integrationRows = [
  ["Auth", "Better Auth, Auth.js, Clerk, Auth0, WorkOS, Supabase"],
  ["Billing", "Stripe, Polar, Autumn with checkout, portals, meters, webhooks"],
  ["Product Ops", "Resend email, jobs through Trigger.dev or Inngest, Unkey API keys"],
  ["AI", "Vercel AI SDK compatible chat routes and UI scaffolds"],
] as const;

function HeroGridRow({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`hidden md:flex ${className}`}>
      {heroGridCells.map((cell) => (
        <div
          key={cell}
          className="h-6 flex-1 border-l border-white/[0.105] last:border-r md:h-8 lg:h-9"
        />
      ))}
    </div>
  );
}

function HeroSideRail({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`hidden border-white/[0.105] md:grid md:grid-rows-8 ${className}`}>
      {heroGridCells.map((cell) => (
        <div key={cell} className="border-b border-white/[0.105] last:border-b-0" />
      ))}
    </div>
  );
}

function HeroCornerMark({ className }: { className: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute z-20 size-5 ${className}`}>
      <span className="absolute left-1/2 top-0 h-full -translate-x-1/2 border-l border-white/25" />
      <span className="absolute left-0 top-1/2 w-full -translate-y-1/2 border-t border-white/25" />
    </span>
  );
}

export default function HomePage(_props: PageProps) {
  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-black font-mono text-white">
      <ConsoleAscii />
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_32%),linear-gradient(180deg,#000_0%,#020202_56%,#000_100%)]" />
      <DitherShader
        aria-hidden
        animated
        animationSpeed={0.03}
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-70 [mask-image:linear-gradient(to_bottom,transparent_0%,transparent_24%,black_43%,black_100%)]"
        colorMode="duotone"
        ditherMode="bayer"
        gridSize={3}
        primaryColor="#000000"
        secondaryColor="#ffffff"
        threshold={0.53}
      />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-[62vh] bg-gradient-to-b from-transparent via-white/[0.02] to-white/[0.04]" />

      <pre
        aria-hidden
        className="pointer-events-none absolute inset-x-1/2 bottom-[-0.5rem] -z-10 w-[86rem] -translate-x-1/2 select-none whitespace-pre font-mono text-[9px] leading-[1.1] text-white/[0.22] [mask-image:linear-gradient(to_bottom,transparent_0%,black_18%,black_100%)] sm:w-[140rem] sm:text-[13px] md:w-[190rem] md:text-[18px]"
        children={asciiField}
      />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-[52vh] bg-gradient-to-b from-black via-black/35 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-black to-transparent" />

      <header className="absolute inset-x-0 top-0 z-30">
        <div className="mx-auto flex h-16 max-w-[92rem] items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" className="font-sans text-sm font-semibold text-white">
            Farm.js
          </a>
          <nav className="flex items-center gap-4 text-sm text-white/70">
            <a href="/docs" className="hover:text-white">
              Docs
            </a>
            <a href="/docs/integrations" className="hover:text-white">
              Integrations
            </a>
            <a href="/docs/examples" className="hover:text-white">
              Examples
            </a>
          </nav>
        </div>
      </header>

      <section className="mx-auto flex min-h-[90dvh] w-full max-w-[92rem] flex-col items-center justify-center px-3 pb-6 pt-16 text-center sm:px-6 sm:pb-8 lg:px-8">
        <div className="relative grid min-h-[calc(90dvh-5.5rem)] w-full grid-cols-10 border-y border-white/[0.12] bg-black/15 sm:min-h-[min(42rem,calc(90dvh-6rem))] md:border-x">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(65%_90%_at_50%_100%,rgba(255,255,255,0.07),transparent_70%)] [mask-image:linear-gradient(to_top,black_0%,transparent_72%)]" />
          <HeroCornerMark className="left-0 top-0 -translate-x-1/2 -translate-y-1/2" />
          <HeroCornerMark className="bottom-0 right-0 translate-x-1/2 translate-y-1/2" />

          <HeroSideRail className="border-r" />

          <div className="col-span-10 flex min-h-0 flex-col md:col-span-8">
            <HeroGridRow className="border-b border-white/[0.105]" />

            <div className="relative flex min-h-[calc(90dvh-5.5rem)] flex-1 flex-col items-center justify-center overflow-hidden border border-white/[0.09] bg-black/30 px-4 py-8 text-center sm:min-h-[24rem] sm:px-8 md:min-h-[27rem] md:px-12 lg:px-16">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_70%_at_50%_0%,rgba(255,255,255,0.07),transparent_68%)]" />
              <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-white/[0.105]" />

              <div className="relative z-10 flex flex-col items-center">
                <p className="font-mono text-xs font-semibold uppercase text-white/80 sm:text-base">
                  [ farm.js ]
                </p>

                <h1 className="mt-6 max-w-6xl text-balance font-sans text-[clamp(2.75rem,14vw,4.8rem)] font-medium leading-[0.92] text-white sm:mt-8 sm:text-7xl md:text-8xl">
                  Ship the framework parts and the product parts together.
                </h1>

                <p className="mt-5 max-w-4xl text-balance font-sans text-base leading-7 text-white/58 sm:mt-7 sm:text-2xl sm:leading-10">
                  Farm.js is a React framework for integrated apps: routing, APIs, auth, billing,
                  storage, docs, cache, PPR, and deployment are designed as one flow.
                </p>

                <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row">
                  <a
                    href="/docs/getting-started"
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-white px-5 text-sm font-semibold text-black transition hover:bg-emerald-100"
                  >
                    Start building
                  </a>
                  <a
                    href="/docs/integrations"
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-white/20 px-5 text-sm font-semibold text-white transition hover:border-white/50"
                  >
                    View integrations
                  </a>
                </div>
              </div>
            </div>

            <div className="relative hidden md:block">
              <HeroGridRow className="border-b border-white/[0.105]" />
              <HeroGridRow className="border-b border-white/[0.105]" />
              <HeroGridRow />
            </div>
          </div>

          <HeroSideRail className="border-l" />
        </div>
      </section>

      <section className="relative z-10 border-y border-white/10 bg-[#f8faf7] text-slate-950">
        <div className="mx-auto grid max-w-[92rem] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:py-24">
          <div>
            <p className="font-sans text-sm font-semibold text-emerald-700">Framework Handbook</p>
            <h2 className="mt-3 max-w-2xl font-sans text-4xl font-semibold leading-tight sm:text-5xl">
              Organized like the frameworks people already know.
            </h2>
            <p className="mt-5 max-w-2xl font-sans text-base leading-7 text-slate-600">
              The docs follow a familiar path from start, routing, data, integrations, runtime,
              content, extending, and reference. It borrows the clarity of framework docs without
              making Farm feel like a clone.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {featuredDocPages.map((page) => (
              <a
                key={page.href}
                href={page.href}
                className="block rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
              >
                <p className="font-sans text-base font-semibold text-slate-950">{page.title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{page.description}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 bg-black text-white">
        <div className="mx-auto max-w-[92rem] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <p className="font-sans text-sm font-semibold text-emerald-300">Product Surface</p>
            <h2 className="mt-3 font-sans text-4xl font-semibold leading-tight sm:text-5xl">
              A compact core with product systems built in.
            </h2>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {productPillars.map((pillar) => (
              <article
                key={pillar.title}
                className="rounded-lg border border-white/10 bg-white/[0.035] p-6"
              >
                <h3 className="font-sans text-xl font-semibold">{pillar.title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/62">{pillar.body}</p>
              </article>
            ))}
          </div>

          <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
              <div className="border-b border-white/10 pb-3 text-sm text-white/60">
                farm.config.ts
              </div>
              <pre className="overflow-x-auto pt-5 text-sm leading-6 text-white/82">
                <code>{`export default defineFarmConfig({
  deploy: { target: "vercel" },
  docs: { entry: "/docs" },
  md: { expose: ["/", "/pricing"], cache: 60 },
  integrations: {
    billing: stripe({ products }),
    auth: betterAuth({ instance: auth }),
  },
  observability: { enabled: true },
});`}</code>
              </pre>
            </div>

            <div className="grid gap-3">
              {frameworkFeatures.map((feature) => (
                <div
                  key={feature}
                  className="flex items-start gap-3 border-b border-white/10 pb-3 text-sm leading-6 text-white/72"
                >
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-300" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 bg-white text-slate-950">
        <div className="mx-auto grid max-w-[92rem] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8 lg:py-24">
          <div>
            <p className="font-sans text-sm font-semibold text-emerald-700">Integrations</p>
            <h2 className="mt-3 font-sans text-4xl font-semibold leading-tight sm:text-5xl">
              Providers contribute routes, APIs, middleware, UI, and schema.
            </h2>
            <p className="mt-5 text-base leading-7 text-slate-600">
              Instead of every package inventing a different setup story, Farm integrations share
              one shape: config validation, lifecycle hooks, typed operations, storage access, and
              optional UI registry entries.
            </p>
          </div>

          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-slate-50">
            {integrationRows.map(([label, body]) => (
              <div key={label} className="grid gap-2 p-5 sm:grid-cols-[9rem_1fr]">
                <p className="font-sans text-base font-semibold text-slate-950">{label}</p>
                <p className="text-sm leading-6 text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 border-t border-white/10 bg-black text-white">
        <div className="mx-auto grid max-w-[92rem] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_0.8fr] lg:px-8 lg:py-24">
          <div>
            <p className="font-sans text-sm font-semibold text-emerald-300">Ready Reference</p>
            <h2 className="mt-3 max-w-3xl font-sans text-4xl font-semibold leading-tight sm:text-5xl">
              Human docs, agent-readable markdown, and API reference from the same app.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/62">
              Farm can serve docs routes, expose markdown mirrors for rendered pages, and publish
              OpenAPI reference pages so people and tools can understand the product surface.
            </p>
          </div>

          <div className="flex flex-col justify-end gap-3">
            <a
              href="/docs/docs-engine"
              className="rounded-lg border border-white/10 bg-white/[0.035] p-5 transition hover:border-emerald-300/60"
            >
              <p className="font-sans font-semibold">Docs engine</p>
              <p className="mt-2 text-sm leading-6 text-white/62">
                Automatic /docs and /api/docs support.
              </p>
            </a>
            <a
              href="/docs/markdown"
              className="rounded-lg border border-white/10 bg-white/[0.035] p-5 transition hover:border-emerald-300/60"
            >
              <p className="font-sans font-semibold">Markdown mirrors</p>
              <p className="mt-2 text-sm leading-6 text-white/62">Expose pages like /pricing.md.</p>
            </a>
            <a
              href="/docs/openapi"
              className="rounded-lg border border-white/10 bg-white/[0.035] p-5 transition hover:border-emerald-300/60"
            >
              <p className="font-sans font-semibold">OpenAPI</p>
              <p className="mt-2 text-sm leading-6 text-white/62">
                Publish generated API reference.
              </p>
            </a>
          </div>
        </div>
      </section>

      <section className="relative z-10 bg-[#f8faf7] text-slate-950">
        <div className="mx-auto flex max-w-[92rem] flex-col gap-6 px-4 py-16 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
          <div>
            <p className="font-sans text-sm font-semibold text-emerald-700">Start small</p>
            <h2 className="mt-3 max-w-3xl font-sans text-4xl font-semibold leading-tight">
              Build the first page, then add integrations when the product asks for them.
            </h2>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href="/docs/getting-started"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              Read the docs
            </a>
            <a
              href="/docs/examples"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-5 text-sm font-semibold text-slate-950 transition hover:border-emerald-500"
            >
              Explore examples
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
