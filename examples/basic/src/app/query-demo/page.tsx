import React from 'react';
import type { PagePropsSafe } from '@farmjs/core/query';
import { 
  loadSearchParams,
  loadRouteParams,
  asString,
  asInteger,
  asBoolean,
  asArrayOf,
} from '@farmjs/core/query/server';
import ClientQueryDemo from './client-demo';

async function ServerQueryDemo({ searchParams , params: p }: PagePropsSafe) {
  const params = await loadSearchParams(searchParams, {
    search: asString.withDefault!(''),
    page: asInteger.withDefault!(1),
    category: asString.withDefault!('all'),
    enabled: asBoolean.withDefault!(false),
    tags: asArrayOf(asString).withDefault!([]),
    sortBy: asString.withDefault!('date'),
    sortOrder: asString.withDefault!('desc'),
  });
  const routeParams = await loadRouteParams(p, {
    section: asString.withDefault!("query-demo"),
  });
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Farm.js Query State Demo
          </h1>
          <p className="text-gray-600">
            Complete demonstration of server-side and client-side query parameter management
          </p>
        </div>

        {/* Server-Side Section */}
        <div className="mb-12 bg-white p-6 rounded-lg shadow">
          <div className="mb-4">
            <h2 className="text-2xl font-semibold text-blue-800 mb-2">
              Server-Side Query State
            </h2>
            <p className="text-gray-600 text-sm">
              This section uses <code className="bg-gray-100 px-1 rounded">loadSearchParams</code> to parse query parameters on the server
            </p>
          </div>
          
          <div className="bg-blue-50 border border-blue-200 p-6 rounded-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p><strong className="text-blue-900">Search:</strong> <span className="text-gray-700">{params.search || 'None'}</span></p>
                <p><strong className="text-blue-900">Page:</strong> <span className="text-gray-700">{params.page}</span></p>
                <p><strong className="text-blue-900">Category:</strong> <span className="text-gray-700">{params.category}</span></p>
                <p><strong className="text-blue-900">Enabled:</strong> <span className="text-gray-700">{params.enabled ? 'Yes' : 'No'}</span></p>
              </div>
              <div>
                <p><strong className="text-blue-900">Tags:</strong> <span className="text-gray-700">{params.tags.length > 0 ? params.tags.join(', ') : 'None'}</span></p>
                <p><strong className="text-blue-900">Sort By:</strong> <span className="text-gray-700">{params.sortBy}</span></p>
                <p><strong className="text-blue-900">Sort Order:</strong> <span className="text-gray-700">{params.sortOrder}</span></p>
                <p><strong className="text-blue-900">Route Section:</strong> <span className="text-gray-700">{routeParams.section}</span></p>
              </div>
            </div>
            
            <div className="mt-4">
              <p className="text-sm font-medium text-blue-900 mb-2">All Parsed Parameters:</p>
              <pre className="bg-white p-3 rounded text-xs overflow-x-auto border border-blue-200">
                {JSON.stringify(params, null, 2)}
              </pre>
            </div>

            <div className="mt-4 p-3 bg-blue-100 rounded">
              <p className="text-xs text-blue-900">
                <strong>💡 Tip:</strong> Try adding query parameters to the URL like: 
                <code className="bg-blue-200 px-1 rounded">?search=react&page=2&category=tech&enabled=true&tags=js,ts</code>
              </p>
            </div>
          </div>
        </div>

        {/* Client-Side Section */}
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="mb-4">
            <h2 className="text-2xl font-semibold text-purple-800 mb-2">
              Client-Side Query State
            </h2>
            <p className="text-gray-600 text-sm">
              This section uses <code className="bg-gray-100 px-1 rounded">useQueryState</code> hooks to manage query parameters in the browser
            </p>
          </div>
          
          <ClientQueryDemo />
        </div>

        {/* Code Examples */}
        <div className="mt-8 bg-white p-6 rounded-lg shadow">
          <h3 className="text-xl font-semibold mb-4">Code Examples</h3>
          
          <div className="space-y-6">
            <div>
              <h4 className="font-medium mb-2 text-blue-800">Server-Side (Server Component)</h4>
              <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
{`import { loadSearchParams, parseAsString, parseAsInteger } from '@farmjs/core/query/server';
import type { PagePropsSafe } from '@farmjs/core/query';

export default async function Page({ searchParams }: PagePropsSafe) {
  const params = await loadSearchParams(searchParams, {
    search: parseAsString.withDefault!(''),
    page: parseAsInteger.withDefault!(1),
  });

  return <div>Search: {params.search}, Page: {params.page}</div>;
}`}
              </pre>
            </div>

            <div>
              <h4 className="font-medium mb-2 text-blue-800">Server-Side Route Params (Type-safe)</h4>
              <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
{`import { loadRouteParams, asInteger } from '@farmjs/core/query/server';

export default async function Page({ params }: PagePropsSafe) {
  const route = await loadRouteParams(params, {
    id: asInteger.withDefault!(0),
  });

  return <div>User ID: {route.id}</div>;
}`}
              </pre>
            </div>

            <div>
              <h4 className="font-medium mb-2 text-purple-800">Client-Side (Client Component)</h4>
              <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
{`'use client';
import { useQueryState, parseAsString, parseAsInteger } from '@farmjs/core/query/client';

export default function Page() {
  const [search, setSearch] = useQueryState('search', parseAsString);
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault!(1));
  
  return (
    <div>
      <input 
        value={search || ''} 
        onChange={(e) => setSearch(e.target.value || null)} 
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

export default ServerQueryDemo;


