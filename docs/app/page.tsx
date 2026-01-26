import Link from "next/link";
import { Button } from "fumadocs-ui/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex h-screen flex-col items-center justify-center text-center">
      <div className="container px-4">
        <div className="mb-8">
          <h1 className="mb-4 text-6xl font-bold">
            🚜{" "}
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Farm.js
            </span>
          </h1>
          <p className="mx-auto max-w-2xl text-xl text-muted-foreground">
            A modern React meta-framework built on Vite with Next.js-like semantics, featuring React
            Server Components and blazing-fast development.
          </p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
          <Button asChild size="lg">
            <Link href="/docs">Get Started</Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href="https://github.com/farm-js/farm.js" target="_blank">
              View on GitHub
            </Link>
          </Button>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-3">
          <FeatureCard
            icon="⚡"
            title="Lightning Fast"
            description="Built on Vite for instant server start and blazing-fast HMR during development."
          />
          <FeatureCard
            icon="⚛️"
            title="React Server Components"
            description="Full RSC support with streaming SSR for optimal performance and user experience."
          />
          <FeatureCard
            icon="🎯"
            title="Next.js-like API"
            description="Familiar file-based routing and app directory structure that developers already know."
          />
        </div>
      </div>
    </main>
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
    <div className="rounded-lg border bg-card p-6 text-card-foreground">
      <div className="mb-2 text-3xl">{icon}</div>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
