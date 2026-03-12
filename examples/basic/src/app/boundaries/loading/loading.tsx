import React from "react";

interface LoadingBoundaryProps {
  path?: string;
  params?: Record<string, string>;
}

export default function LoadingBoundary({ path }: LoadingBoundaryProps) {
  return (
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
      {path != null && <p className="text-xs text-blue-600 mt-4">path: {path}</p>}
    </div>
  );
}
