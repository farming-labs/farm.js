import React from 'react';

export default function DelayedContent() {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4" data-testid="suspense-content">
      <p className="font-semibold text-green-900">Content loaded</p>
      <p className="text-sm text-green-800 mt-1">
        This is rendered by the lazy component after Suspense resolves.
      </p>
    </div>
  );
}
