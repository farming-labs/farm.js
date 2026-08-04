/**
 * Home Page - SSR (Server-Side Rendering)
 * 
 * This page renders on EVERY request.
 * No special exports needed - SSR is the default!
 * 
 * Use SSR when:
 * - Content changes frequently
 * - Content is personalized per user
 * - You need real-time data
 */

import { aliasVerification } from "@/lib/alias-verification";

// Simulate fetching real-time data
async function getCurrentTime() {
  // In real app, this could be: await fetch('/api/time')
  return new Date().toISOString();
}

export const metadata = {
  title: "Home - SSR Demo",
  description: "This page is server-rendered on each request",
};

export default async function HomePage() {
  const currentTime = await getCurrentTime();

  return (
    <div className="space-y-8" data-alias-verification={aliasVerification}>
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
            SSR
          </span>
          <span className="text-gray-500">Server-Side Rendering</span>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Welcome to Farm.js
        </h1>

        <p className="text-gray-600 mb-6">
          This page is rendered on the server for <strong>every request</strong>.
          The time below updates on each page load.
        </p>

        <div className="bg-gray-100 rounded-lg p-4">
          <p className="text-sm text-gray-500 mb-1">Server Time:</p>
          <p className="text-2xl font-mono text-gray-900">{currentTime}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-3">SSR Pages</h2>
          <p className="text-gray-600 mb-4">
            No special exports needed. SSR is the default behavior.
          </p>
          <pre className="bg-gray-100 rounded p-3 text-sm overflow-x-auto">
{`// No special exports = SSR
export default function Page() {
  return <div>Hello</div>;
}`}
          </pre>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-3">SSG Pages</h2>
          <p className="text-gray-600 mb-4">
            Add <code className="bg-gray-100 px-1 rounded">export const ssg = true</code> to pre-render.
          </p>
          <pre className="bg-gray-100 rounded p-3 text-sm overflow-x-auto">
{`// SSG = pre-render at build time
export const ssg = true;

export default function Page() {
  return <div>Static</div>;
}`}
          </pre>
        </div>
      </div>
    </div>
  );
}
