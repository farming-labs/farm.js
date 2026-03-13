import React from "react";

export default async function SlowDetails() {
  await new Promise((resolve) => setTimeout(resolve, 2500));

  return (
    <div data-testid="route-loading-final" className="rounded-lg border border-green-200 bg-green-50 p-4">
      <p className="font-semibold text-green-900">Data loaded</p>
      <p className="text-sm text-green-800 mt-1">
        This content appears after the “fetch” (or async work) finishes. The loading.tsx UI is replaced by this.
      </p>
    </div>
  );
}
