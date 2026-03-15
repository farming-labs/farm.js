import React from 'react'
import type { PageProps, Metadata } from '@farmjs/core'
import { Link } from '@farmjs/core/client'

// Note: This page uses Link components which require hydration
// SSG is better suited for pages without client-side interactivity
// export const prerender = true;

export const metadata: Metadata = {
  title: "Home | Farm.js",
  description: "A modern React meta-framework built on Vite with Next.js-like semantics",
  keywords: ["react", "vite", "meta-framework", "ssr", "farm.js"],
};

export default function HomePage({ params, searchParams }: PageProps) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
          Welcome to Farm.js 0.0.1
        </h1>
        
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
          A modern React meta-framework built on Vite with Next.js-like semantics
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <FeatureCard
          icon="⚡"
          title="Blazing Fast"
          description="Built on Vite for instant HMR and lightning-fast builds"
        />
        <FeatureCard
          icon="⚛️"
          title="React Server Components"
          description="Full RSC support with streaming SSR"
        />
        <FeatureCard
          icon="🎯"
          title="Next.js-like API"
          description="Familiar file-based routing and app directory"
        />
        <FeatureCard
          icon="📦"
          title="Zero Config"
          description="Works out of the box with sensible defaults"
        />
        <FeatureCard
          icon="🎨"
          title="Tailwind CSS"
          description="Built-in Tailwind support for beautiful UIs"
        />
        <FeatureCard
          icon="🧪"
          title="Type Safe"
          description="Full TypeScript support throughout"
        />
        <FeatureCard
          icon="🚀"
          title="API Routes"
          description="Type-safe API endpoints with better-call"
          href="/api-demo"
        />
        <FeatureCard
          icon="🗃️"
          title="Global Store"
          description="Built-in global client store with direct field subscriptions"
          href="/store-e2e"
        />
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
        <h3 className="text-lg font-semibold mb-4 text-gray-900">📊 Request Information</h3>
        <p className="text-sm text-gray-600 mb-3">
          PageProps received by this component:
        </p>
        <pre className="bg-gray-50 p-4 rounded-md text-sm overflow-auto border border-gray-200">
          {JSON.stringify({ params, searchParams }, null, 2)}
        </pre>
        <p className="text-xs text-gray-500 mt-3">
          Try adding query params: <Link href="/?name=John&framework=Farm.js" className="text-blue-600 hover:underline">/?name=John&framework=Farm.js</Link>
        </p>
      </div>

      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-6 border border-blue-200">
        <h3 className="text-lg font-semibold mb-2 text-gray-900">🚀 Quick Links</h3>
        <div className="flex flex-wrap gap-3">
          <Link href="/about" className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
            About Page
          </Link>
          <Link href="/contact" className="inline-flex items-center px-4 py-2 bg-white text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50 transition-colors">
            Contact
          </Link>
          <Link href="/users/123?tab=profile" className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors">
            Dynamic Route Demo
          </Link>
          <Link href="/api-demo" className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors">
            API Demo (Server)
          </Link>
          <Link href="/api-demo-client" className="inline-flex items-center px-4 py-2 bg-pink-600 text-white rounded-md hover:bg-pink-700 transition-colors">
            API Demo (Client)
          </Link>
          <Link href="/api-demo-client-advanced" className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors">
            API Client Advanced
          </Link>
          <Link href="/query-demo" className="inline-flex items-center px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 transition-colors">
            Query State Demo
          </Link>
          <Link href="/store-e2e" className="inline-flex items-center px-4 py-2 bg-slate-800 text-white rounded-md hover:bg-slate-900 transition-colors">
            Global Store Demo
          </Link>
          <Link href="/boundaries/loading" className="inline-flex items-center px-4 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-700 transition-colors">
            Loading Boundary
          </Link>
          <Link href="/boundaries/suspense" className="inline-flex items-center px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors">
            React Suspense
          </Link>
          <Link href="/docs/reference" className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors">
            📚 API Documentation
          </Link>
        </div>
      </div>
    </div>
  )
}

function FeatureCard({ icon, title, description, href }: {
  icon: string
  title: string
  description: string
  href?: string
}) {
  const content = (
    <>
      <div className="text-4xl mb-3">{icon}</div>
      <h3 className="text-lg font-semibold mb-2 text-gray-900">{title}</h3>
      <p className="text-sm text-gray-600">{description}</p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="bg-white rounded-lg p-6 shadow-md border border-gray-200 hover:shadow-lg hover:border-blue-400 transition-all block">
        {content}
      </Link>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6 shadow-md border border-gray-200 hover:shadow-lg transition-shadow">
      {content}
    </div>
  );
}
