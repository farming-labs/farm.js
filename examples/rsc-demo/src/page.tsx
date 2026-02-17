// Home page - Server Component (default)
// This is a server component that renders on the server
// and streams to the client. No JavaScript is sent for this component!

import React from "react";

export const metadata = {
  title: "Home | Farm.js RSC Demo",
  description: "Welcome to the Farm.js React Server Components demo",
};

// This function runs on the server
async function getServerTime() {
  // Simulate async data fetching
  await new Promise((resolve) => setTimeout(resolve, 100));
  return new Date().toISOString();
}

export default async function HomePage() {
  // This runs on the server - no client-side JavaScript!
  const serverTime = await getServerTime();

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
          React Server Components
        </h1>
        <p className="text-xl text-slate-400">
          Zero client-side JavaScript for this page!
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
          <h2 className="text-2xl font-semibold text-emerald-400 mb-4">
            ⚡ Server Component
          </h2>
          <p className="text-slate-300 mb-4">
            This entire page is a Server Component. It renders on the server and
            streams HTML to the client. No React bundle needed for static content!
          </p>
          <div className="bg-slate-900/50 rounded-lg p-4 font-mono text-sm">
            <span className="text-slate-500">Server Time:</span>{" "}
            <span className="text-cyan-400">{serverTime}</span>
          </div>
        </div>

        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
          <h2 className="text-2xl font-semibold text-purple-400 mb-4">
            🎯 What's Special?
          </h2>
          <ul className="space-y-2 text-slate-300">
            <li className="flex items-start gap-2">
              <span className="text-emerald-400">✓</span>
              <span>Async/await directly in components</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400">✓</span>
              <span>Direct database access (no API needed)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400">✓</span>
              <span>Smaller bundle sizes</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400">✓</span>
              <span>Streaming SSR</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="bg-gradient-to-r from-emerald-900/30 to-cyan-900/30 rounded-xl p-6 border border-emerald-700/30">
        <h3 className="text-xl font-semibold text-white mb-4">
          Try the demos:
        </h3>
        <div className="flex flex-wrap gap-4">
          <a
            href="/counter"
            className="px-6 py-3 bg-purple-600 hover:bg-purple-500 rounded-lg font-semibold transition-colors"
          >
            Counter (Client Component)
          </a>
          <a
            href="/form"
            className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition-colors"
          >
            Form (Server Actions)
          </a>
          <a
            href="/about"
            className="px-6 py-3 bg-slate-600 hover:bg-slate-500 rounded-lg font-semibold transition-colors"
          >
            About (Server Component)
          </a>
        </div>
      </div>
    </div>
  );
}
