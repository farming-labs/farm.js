import React from 'react';

export const experimental_ppr = true;
export const revalidate = 60;

export const metadata = {
  title: 'PPR Demo | Farm.js',
  description: 'Static shell caching demo powered by Farm.js PPR route config',
};

export default function PPRDemoPage() {
  const renderedAt = new Date().toISOString();

  return (
    <main className="max-w-3xl mx-auto space-y-6">
      <section className="space-y-3">
        <h1 className="text-4xl font-bold text-gray-900">PPR Static Shell</h1>
        <p className="text-lg text-gray-600 leading-relaxed">
          This route opts into the Next-compatible{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5">experimental_ppr</code> export.
          Farm caches the rendered shell and reuses the shared path revalidation cache.
        </p>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-900">Rendered at</h2>
        <code className="mt-3 block rounded bg-gray-950 p-4 text-sm text-green-300">
          {renderedAt}
        </code>
      </section>
    </main>
  );
}
