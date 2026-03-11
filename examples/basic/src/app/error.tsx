'use client';

import React from 'react';

/**
 * Route-level error boundary (Next.js-style).
 * Catches errors during SSR and client render for this segment.
 * Receives: error, reset(), and optional params, path, searchParams.
 */
interface ErrorBoundaryProps {
  error: unknown;
  reset: () => void;
  path?: string;
  params?: Record<string, string>;
  searchParams?: Record<string, string | string[]>;
}

function getMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

export default function ErrorBoundary({ error, reset, path }: ErrorBoundaryProps) {
  return (
    <div className="min-h-[200px] flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-6">
      <h2 className="text-lg font-semibold text-red-900 mb-2">Something went wrong</h2>
      <p className="text-sm text-red-700 mb-4 font-mono max-w-xl break-words">
        {getMessage(error)}
      </p>
      {path != null && (
        <p className="text-xs text-red-600 mb-4">Route: {path}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium"
      >
        Try again
      </button>
    </div>
  );
}
