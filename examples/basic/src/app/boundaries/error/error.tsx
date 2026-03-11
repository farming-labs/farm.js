import React from "react";

interface RouteErrorBoundaryProps {
  error: unknown;
  path: string;
}

function getMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

export default function RouteErrorBoundary({ error, path }: RouteErrorBoundaryProps) {
  return (
    <section data-testid="route-error-boundary" className="space-y-3 rounded border border-red-200 bg-red-50 p-4">
      <h1 className="text-xl font-bold text-red-900">Route Error Boundary</h1>
      <p className="text-sm text-red-700">path: {path}</p>
      <p data-testid="route-error-message" className="text-sm text-red-700">
        {getMessage(error)}
      </p>
    </section>
  );
}
