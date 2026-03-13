'use client';

import React, { Suspense } from 'react';

/**
 * React Suspense example: lazy-loaded component with a fallback.
 * You see the fallback first, then the content after the lazy import resolves.
 * This pattern works for code-splitting and async data (e.g. use(promise)).
 */
const DelayedContent = React.lazy(() =>
  new Promise<{ default: React.ComponentType }>((resolve) => {
    setTimeout(() => resolve(import('./delayed-content')), 2000);
  })
);

const Fallback = () => (
  <div className="rounded-lg border border-amber-200 bg-amber-50 p-6" data-testid="suspense-fallback">
    <p className="font-semibold text-amber-900 mb-2">Loading…</p>
    <p className="text-sm text-amber-800 mb-4">React Suspense fallback. Content will appear when the lazy component is ready.</p>
    <div className="animate-pulse flex flex-col gap-2 w-48">
      <div className="h-3 bg-amber-200 rounded" />
      <div className="h-3 bg-amber-200 rounded w-4/5" />
      <div className="h-3 bg-amber-200 rounded w-3/5" />
    </div>
  </div>
);

export default function SuspenseExamplePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">React Suspense Example</h1>
      <p className="text-gray-600">
        This page uses <code className="bg-gray-100 px-1 rounded">React.Suspense</code> and{' '}
        <code className="bg-gray-100 px-1 rounded">React.lazy()</code>. The fallback is shown until the lazy
        component loads (~2s), then it swaps to the real content.
      </p>
      <Suspense fallback={<Fallback />}>
        <DelayedContent />
      </Suspense>
    </section>
  );
}
