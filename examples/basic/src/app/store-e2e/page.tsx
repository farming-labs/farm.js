"use client";

import StoreDemo from "./store-demo";

export default function StoreE2EPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Global Store Demo</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          This page exists to verify the built-in global store API, field-level updates, and
          rerender isolation in the browser.
        </p>
      </div>

      <StoreDemo />
    </div>
  );
}
