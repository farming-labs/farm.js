// Counter page - Mix of Server and Client Components
// The page itself is a Server Component, but it imports a Client Component

import React from "react";
import { Counter } from "../components/Counter";

export const metadata = {
  title: "Counter | Farm.js RSC Demo",
  description: "Client Component demo with useState",
};

interface PageProps {
  params: Record<string, string>;
  searchParams: Record<string, string>;
  middlewareData?: {
    pageLoadedAt?: string;
    visitorId?: string;
    featureFlags?: {
      darkMode: boolean;
      newUI: boolean;
      analytics: boolean;
    };
  };
}

export default function CounterPage({ middlewareData = {} }: PageProps) {
  // This code runs on the server
  const serverInfo = `Rendered at ${new Date().toLocaleTimeString()}`;
  const { pageLoadedAt, visitorId, featureFlags } = middlewareData;

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-4">
          Client Components
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto">
          Use <code className="text-purple-400">"use client"</code> to mark
          components that need browser APIs like useState or useEffect.
        </p>
      </div>

      {/* Middleware Data Section */}
      {visitorId && (
        <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/30 rounded-xl p-6 border border-purple-700/30">
          <h3 className="text-xl font-semibold text-purple-400 mb-4">
            🔌 Middleware Data (Shared from /counter middleware)
          </h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-slate-900/50 rounded-lg p-4">
              <p className="text-slate-500 text-sm">Visitor ID</p>
              <p className="text-cyan-400 font-mono">{visitorId}</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-4">
              <p className="text-slate-500 text-sm">Page Loaded At</p>
              <p className="text-emerald-400 font-mono">{pageLoadedAt}</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-4">
              <p className="text-slate-500 text-sm">Feature Flags</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {featureFlags && Object.entries(featureFlags).map(([key, value]) => (
                  <span key={key} className={`px-2 py-1 rounded text-xs ${value ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}>
                    {key}: {value ? 'ON' : 'OFF'}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* This is the Client Component with interactivity */}
        <Counter />

        {/* This section is server-rendered */}
        <div className="bg-slate-800/50 rounded-xl p-6 border border-emerald-700/50">
          <h3 className="text-xl font-semibold text-emerald-400 mb-4">
            Server-Rendered Info
          </h3>
          <p className="text-slate-400 mb-4">
            This section is a Server Component. It's pure HTML with no
            JavaScript.
          </p>
          <div className="bg-slate-900/50 rounded-lg p-4 font-mono text-sm">
            <span className="text-emerald-400" suppressHydrationWarning>
              {serverInfo}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-4">
            Refresh the page to see the time update (server-rendered).
          </p>
        </div>
      </div>

      <div className="bg-slate-800/30 rounded-xl p-6 border border-slate-700">
        <h2 className="text-2xl font-semibold text-white mb-4">
          How Client Components Work
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-lg font-semibold text-purple-400 mb-2">
              Component Code
            </h4>
            <pre className="bg-slate-900/50 rounded-lg p-4 overflow-x-auto text-sm">
              <code className="text-slate-300">{`"use client";

import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(c => c + 1)}>
      Count: {count}
    </button>
  );
}`}</code>
            </pre>
          </div>
          <div>
            <h4 className="text-lg font-semibold text-emerald-400 mb-2">
              Key Points
            </h4>
            <ul className="space-y-2 text-slate-300">
              <li className="flex items-start gap-2">
                <span className="text-purple-400">1.</span>
                <span>
                  <code className="text-purple-400">"use client"</code> at the
                  top marks the boundary
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400">2.</span>
                <span>Component is pre-rendered on the server</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400">3.</span>
                <span>JavaScript is sent to the client for interactivity</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400">4.</span>
                <span>React "hydrates" to make it interactive</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
