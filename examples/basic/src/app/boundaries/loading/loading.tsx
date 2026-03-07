import React from "react";

interface LoadingBoundaryProps {
  path: string;
  params: Record<string, string>;
}

export default function LoadingBoundary({ path, params }: LoadingBoundaryProps) {
  return (
    <div data-testid="route-loading-boundary" className="rounded border border-blue-200 bg-blue-50 p-4">
      <p className="font-semibold text-blue-900">Route Loading Boundary</p>
      <p className="text-sm text-blue-700">path: {path}</p>
      <p className="text-sm text-blue-700">params: {JSON.stringify(params)}</p>
    </div>
  );
}
