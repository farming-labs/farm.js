'use client';

import React, { useState, useEffect } from 'react';

/**
 * Client page: shows loading UI first, then "Data loaded" after ~2.5s.
 * As a full client component the timer runs after hydration so the transition always happens.
 */
export default function RouteLoadingBoundaryPage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 2500);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Route Loading Boundary Demo</h1>
      <p className="text-gray-600">
        You’ll see the <strong>loading</strong> state below for ~2.5s, then it switches to the final content.
      </p>
      {!ready ? (
        <div data-testid="route-loading-boundary" className="rounded-lg border border-blue-200 bg-blue-50 p-6">
          <p className="font-semibold text-blue-900 mb-2">Route Loading Boundary</p>
          <p className="text-sm text-blue-700 mb-4">
            Loading this route… (fetch / render in progress). You see this until the data or component is ready.
          </p>
          <div className="animate-pulse flex flex-col gap-3 w-full max-w-sm">
            <div className="h-4 bg-blue-200 rounded w-3/4" />
            <div className="h-4 bg-blue-200 rounded w-1/2" />
            <div className="h-4 bg-blue-200 rounded w-5/6" />
          </div>
          <p className="text-xs text-blue-600 mt-4">path: /boundaries/loading</p>
        </div>
      ) : (
        <div data-testid="route-loading-final" className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="font-semibold text-green-900">Data loaded</p>
          <p className="text-sm text-green-800 mt-1">
            This content appears after the “fetch” (or async work) finishes. The loading UI is replaced by this.
          </p>
        </div>
      )}
    </section>
  );
}
