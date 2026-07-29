import React from "react";

export const metadata = {
  title: "About | Farm.js RSC Demo",
  description: "Learn about React Server Components",
};

interface PageProps {
  params: Record<string, string>;
  searchParams: Record<string, string>;
  middlewareData?: {
    pageLoadedAt?: string;
    company?: {
      name: string;
      founded: number;
      mission: string;
    };
    team?: Array<{ name: string; role: string }>;
  };
}

// Simulate fetching data from a database
async function getFeatures() {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return [
    {
      title: "Zero Bundle Size",
      description:
        "Server Components don't add any JavaScript to your client bundle. Only Client Components with 'use client' add to the bundle.",
      icon: "📦",
    },
    {
      title: "Direct Backend Access",
      description:
        "Access your database, file system, or any backend service directly in your components. No API routes needed!",
      icon: "🔌",
    },
    {
      title: "Automatic Code Splitting",
      description:
        "Client Components are automatically code-split. The framework handles optimal loading for you.",
      icon: "✂️",
    },
    {
      title: "Streaming SSR",
      description:
        "Content streams to the browser as it's ready. Users see content faster, especially on slow connections.",
      icon: "🌊",
    },
    {
      title: "Server Actions",
      description:
        "Define server-side functions that can be called directly from Client Components. Forms, mutations, and more!",
      icon: "⚡",
    },
  ];
}

export default async function AboutPage({ middlewareData = {} }: PageProps) {
  const features = await getFeatures();
  const { pageLoadedAt, company, team } = middlewareData;

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-4">
          About React Server Components
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto">
          RSC is a new paradigm that lets you render React components on the
          server, reducing client-side JavaScript and improving performance.
        </p>
      </div>

      {/* Middleware Data Section */}
      {company && (
        <div className="bg-gradient-to-r from-emerald-900/30 to-cyan-900/30 rounded-xl p-6 border border-emerald-700/30">
          <h3 className="text-xl font-semibold text-emerald-400 mb-4">
            🔌 Middleware Data (Shared from /about middleware)
          </h3>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h4 className="text-white font-semibold mb-2">{company.name}</h4>
              <p className="text-slate-400 text-sm">Founded: {company.founded}</p>
              <p className="text-cyan-400 mt-2">{company.mission}</p>
              <p className="text-slate-500 text-xs mt-2">Page loaded: {pageLoadedAt}</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h4 className="text-white font-semibold mb-2">Team</h4>
              <div className="space-y-2">
                {team?.map((member, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-slate-300">{member.name}</span>
                    <span className="text-purple-400 text-sm">{member.role}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((feature, i) => (
          <div
            key={i}
            className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 hover:border-emerald-700/50 transition-colors"
          >
            <div className="text-4xl mb-4">{feature.icon}</div>
            <h3 className="text-xl font-semibold text-white mb-2">
              {feature.title}
            </h3>
            <p className="text-slate-400">{feature.description}</p>
          </div>
        ))}
      </div>

      <div className="bg-slate-800/30 rounded-xl p-6 border border-slate-700">
        <h2 className="text-2xl font-semibold text-white mb-4">
          How It Works in Farm.js
        </h2>
        <pre className="bg-slate-900/50 rounded-lg p-4 overflow-x-auto text-sm">
          <code className="text-emerald-400">{`// farm.config.ts
import rsc from '@farm.js/plugin/rsc'

export default {
  experimental: {
    serverComponents: true,
    serverActions: true,
  },
  plugins: [rsc()],
}`}</code>
        </pre>
      </div>
    </div>
  );
}
