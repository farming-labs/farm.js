"use client";

/**
 * Dashboard Page - SSR with Client Interactivity
 * 
 * This page is server-rendered on each request (SSR is default).
 * It also includes client-side interactivity with "use client".
 * 
 * Use SSR for dashboards when:
 * - Data is personalized per user
 * - Real-time data is important
 * - You need server-side authentication checks
 */

import { useState, useEffect } from "react";

export default function DashboardPage() {
  const [count, setCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  useEffect(() => {
    setLastUpdated(new Date().toISOString());
  }, []);

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
            SSR
          </span>
          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
            Client Interactive
          </span>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Dashboard
        </h1>

        <p className="text-gray-600 mb-4">
          This page demonstrates <strong>SSR with client-side interactivity</strong>.
          The page is server-rendered, then hydrated on the client for interactivity.
        </p>

        <div className="bg-gray-100 rounded-lg p-4">
          <p className="text-sm text-gray-500">Client-side time: {lastUpdated}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-sm text-gray-500 mb-2">Total Users</h2>
          <p className="text-3xl font-bold text-gray-900">1,234</p>
          <p className="text-green-600 text-sm">+12% from last week</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-sm text-gray-500 mb-2">Page Views</h2>
          <p className="text-3xl font-bold text-gray-900">45.2K</p>
          <p className="text-green-600 text-sm">+8% from last week</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-sm text-gray-500 mb-2">Conversion Rate</h2>
          <p className="text-3xl font-bold text-gray-900">3.2%</p>
          <p className="text-red-600 text-sm">-0.5% from last week</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          Interactive Counter (Client-Side)
        </h2>

        <p className="text-gray-600 mb-4">
          This counter demonstrates client-side interactivity after hydration.
        </p>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setCount(c => c - 1)}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-bold"
          >
            -
          </button>
          <span className="text-4xl font-bold text-gray-900 w-20 text-center">
            {count}
          </span>
          <button
            onClick={() => setCount(c => c + 1)}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-bold"
          >
            +
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Code Example</h2>
        <pre className="bg-gray-100 rounded p-4 text-sm overflow-x-auto">
{`"use client";

// No ssg export = SSR (default)
// "use client" enables interactivity

import { useState } from "react";

export default function DashboardPage() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>
        Increment
      </button>
    </div>
  );
}`}
        </pre>
      </div>
    </div>
  );
}
