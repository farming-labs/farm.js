'use client';

import React from 'react';
import ClientQueryDemo from './client-demo';

export default function QueryDemoPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Farm.js Query State Demo
          </h1>
          <p className="text-gray-600">
            Complete demonstration of browser-side query parameter management.
          </p>
        </div>

        <div className="mb-12 bg-white p-6 rounded-lg shadow">
          <div className="mb-4">
            <h2 className="text-2xl font-semibold text-blue-800 mb-2">
              Query State Overview
            </h2>
            <p className="text-gray-600 text-sm">
              This demo is a hydrated client route so every control below can update the URL and
              page state immediately.
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 p-6 rounded-lg">
            <p className="text-sm text-blue-900">
              Try adding query parameters to the URL like{' '}
              <code className="bg-blue-200 px-1 rounded">
                ?search=react&page=2&category=tech&enabled=true&tags=js,ts
              </code>
              , then use the controls below to update them.
            </p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="mb-4">
            <h2 className="text-2xl font-semibold text-purple-800 mb-2">
              Client-Side Query State
            </h2>
            <p className="text-gray-600 text-sm">
              This section uses{' '}
              <code className="bg-gray-100 px-1 rounded">useQueryState</code> hooks to manage
              query parameters in the browser.
            </p>
          </div>

          <ClientQueryDemo />
        </div>

        <div className="mt-8 bg-white p-6 rounded-lg shadow">
          <h3 className="text-xl font-semibold mb-4">Code Examples</h3>

          <div className="space-y-6">
            <div>
              <h4 className="font-medium mb-2 text-purple-800">
                Client-Side Query State
              </h4>
              <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
{`'use client';
import { useQueryState, asString, asInteger } from '@farm.js/core/query/client';

export default function Page() {
  const [search, setSearch] = useQueryState('search', asString);
  const [page, setPage] = useQueryState('page', asInteger.withDefault!(1));

  return (
    <div>
      <input
        value={search || ''}
        onChange={(event) => setSearch(event.target.value || null)}
      />
      <button onClick={() => setPage(page + 1)}>Next Page</button>
    </div>
  );
}`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
