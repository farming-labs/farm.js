"use client";

import React, { useState } from "react";
import { Link } from "@farm.js/core/client";

interface DemoApiResponse {
  user: {
    profile: {
      formatDisplayName(): string;
    };
  };
}

export default function RuntimeErrorDemoPage() {
  const [displayName, setDisplayName] = useState("Waiting for a profile");

  const triggerRuntimeError = () => {
    const response = {
      user: { profile: { displayName: "Ada Lovelace" } },
    } as unknown as DemoApiResponse;

    window.setTimeout(() => {
      // The deployed API still returns displayName, but this client expects the newer SDK method.
      setDisplayName(response.user.profile.formatDisplayName());
    }, 0);
  };

  const triggerUnhandledRejection = () => {
    void Promise.reject(
      new Error("Intentional rejected promise from the runtime error demo"),
    );
  };

  return (
    <section className="mx-auto max-w-3xl py-8 sm:py-14">
      <div className="mb-8 flex items-center gap-3 text-sm font-medium text-gray-500">
        <span className="h-px w-8 bg-gray-300" aria-hidden="true" />
        Development diagnostic
      </div>

      <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-gray-950 sm:text-5xl">
        Test the browser runtime error overlay
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-gray-600">
        These controls intentionally reproduce failures that can happen after a page hydrates.
        Farm.js should catch them and show a useful source location, debug report, and recovery
        actions.
      </p>

      <div className="mt-10 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
            Real failure scenarios
          </p>
        </div>

        <div className="divide-y divide-gray-200">
          <div className="grid gap-5 p-6 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <h2 className="font-semibold text-gray-950">Unexpected API response</h2>
              <p className="mt-1 text-sm leading-6 text-gray-600">
                Calls a profile formatter added by a newer client, while the API still returns
                the older data shape.
              </p>
              <p className="mt-2 font-mono text-xs text-gray-500">Preview: {displayName}</p>
            </div>
            <button
              type="button"
              onClick={triggerRuntimeError}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-red-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
            >
              Trigger runtime error
            </button>
          </div>

          <div className="grid gap-5 p-6 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <h2 className="font-semibold text-gray-950">Unhandled async failure</h2>
              <p className="mt-1 text-sm leading-6 text-gray-600">
                Rejects a promise without a catch handler, like a failed background task.
              </p>
            </div>
            <button
              type="button"
              onClick={triggerUnhandledRejection}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-gray-300 bg-white px-5 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500"
            >
              Trigger rejected promise
            </button>
          </div>
        </div>
      </div>

      <p className="mt-6 text-sm leading-6 text-gray-500">
        The overlay is development-only. Production builds keep the browser's normal error
        behavior. <Link href="/" className="font-medium text-blue-700 hover:underline">Return home</Link>
      </p>
    </section>
  );
}
