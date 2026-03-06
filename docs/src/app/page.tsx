import type { PageProps } from "@farmjs/core";
import { Link } from "@farmjs/core";

export const metadata = {
  title: "Farm.js - Modern React meta-framework",
  description:
    "A modern React meta-framework built on Vite with Next.js-like semantics, React Server Components, and blazing-fast development.",
};

export default function HomePage(_props: PageProps) {
  return (
    <div>
      <section className="relative overflow-hidden border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl md:text-6xl">
              <span className="block">Build fast with</span>
              <span className="mt-2 block bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                Farm.js
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
              A modern React meta-framework built on Vite with Next.js-like semantics, featuring
              React Server Components and a blazing-fast development experience.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/docs/getting-started"
                className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                Get Started
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
              >
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">
            Everything you need to build modern React apps
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">
            Farm.js combines the best of Vite and Next.js into one cohesive framework.
          </p>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon="⚡"
              title="Lightning fast"
              description="Built on Vite for instant server start and blazing-fast HMR during development."
            />
            <FeatureCard
              icon="⚛️"
              title="React Server Components"
              description="Full RSC support with streaming SSR for optimal performance and smaller client bundles."
            />
            <FeatureCard
              icon="🎯"
              title="Next.js-like API"
              description="Familiar file-based routing and app directory structure that developers already know."
            />
            <FeatureCard
              icon="🔄"
              title="Server Actions"
              description="Seamless server-client data mutations without writing API routes by hand."
            />
            <FeatureCard
              icon="📦"
              title="Zero config"
              description="Works out of the box with sensible defaults. Tailwind CSS is pre-configured."
            />
            <FeatureCard
              icon="🧪"
              title="Type safe"
              description="Full TypeScript support and type-safe APIs throughout the framework."
            />
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Ready to get started?</h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-600">
            Create a new Farm.js app in seconds and start building.
          </p>
          <div className="mt-8">
            <Link
              href="/docs/getting-started"
              className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-emerald-500"
            >
              Get Started
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="text-3xl" aria-hidden>
        {icon}
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-slate-600">{description}</p>
    </div>
  );
}
