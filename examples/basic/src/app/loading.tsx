import React from 'react';

/**
 * Route-level loading boundary (Next.js-style).
 * Shown while the route segment is loading (e.g. async page/layout, streaming SSR).
 * Receives: path, and optional params.
 */
interface LoadingBoundaryProps {
  path?: string;
  params?: Record<string, string>;
}

export default function LoadingBoundary({ path }: LoadingBoundaryProps) {
  return (
    <div className="min-h-[200px] flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-6">
      <div className="animate-pulse flex flex-col gap-3 w-full max-w-sm">
        <div className="h-4 bg-gray-200 rounded w-3/4" />
        <div className="h-4 bg-gray-200 rounded w-1/2" />
        <div className="h-4 bg-gray-200 rounded w-5/6" />
      </div>
      {path != null && (
        <p className="text-xs text-gray-500 mt-4">Loading {path}</p>
      )}
    </div>
  );
}
