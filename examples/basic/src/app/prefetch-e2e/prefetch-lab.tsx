"use client";

import { Link } from "@farmjs/core/client";
import { useEffect, useMemo, useState } from "react";

type PrefetchLog = {
  href: string;
  at: number;
};

declare global {
  interface Window {
    __FARM_PREFETCH_LOGS__?: PrefetchLog[];
    __FARM_PREFETCH_E2E__?: {
      getLogs: () => PrefetchLog[];
      clear: () => void;
    };
    __FARM_SPA_ROUTER__?: {
      prefetch?: (href: string) => Promise<void>;
    };
  }
}

export default function PrefetchLab() {
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let stopped = false;
    let cleanup: (() => void) | undefined;

    const ensureStore = () => {
      if (!window.__FARM_PREFETCH_LOGS__) {
        window.__FARM_PREFETCH_LOGS__ = [];
      }
      if (!window.__FARM_PREFETCH_E2E__) {
        window.__FARM_PREFETCH_E2E__ = {
          getLogs: () => [...(window.__FARM_PREFETCH_LOGS__ || [])],
          clear: () => {
            window.__FARM_PREFETCH_LOGS__ = [];
          },
        };
      }
    };

    const tryPatch = () => {
      ensureStore();
      const router = window.__FARM_SPA_ROUTER__;
      if (!router || typeof router.prefetch !== "function") {
        return false;
      }
      const originalPrefetch = router.prefetch.bind(router);
      router.prefetch = async (href: string) => {
        window.__FARM_PREFETCH_LOGS__?.push({ href, at: Date.now() });
        return originalPrefetch(href);
      };
      setReady(true);
      cleanup = () => {
        router.prefetch = originalPrefetch;
      };
      return true;
    };

    if (!tryPatch()) {
      const interval = window.setInterval(() => {
        if (stopped) return;
        if (tryPatch()) {
          window.clearInterval(interval);
        }
      }, 30);
      cleanup = () => window.clearInterval(interval);
    }

    return () => {
      stopped = true;
      cleanup?.();
    };
  }, []);

  const logs = useMemo(() => {
    if (typeof window === "undefined") {
      return [];
    }

    return window.__FARM_PREFETCH_LOGS__ || [];
  }, [tick]);

  return (
    <div className="space-y-6">
      <p data-testid="hydrated" className="text-sm text-slate-500">
        {ready ? "yes" : "no"}
      </p>

      <div>
        <h2 className="text-xl font-semibold text-slate-900">Prefetch E2E Lab</h2>
        <p className="text-slate-600">
          This page records router prefetch calls so Playwright can verify prefetch behavior.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {ready ? (
          <Link
            data-testid="link-render"
            href="/about?mode=render"
            prefetch="render"
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            Render prefetch
          </Link>
        ) : null}
        <Link
          data-testid="link-intent"
          href="/about?mode=intent"
          prefetch="intent"
          prefetchDelay={20}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          Intent prefetch
        </Link>
        <Link
          data-testid="link-intent-cancel"
          href="/about?mode=intent-cancel"
          prefetch="intent"
          prefetchDelay={250}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          Intent cancel prefetch
        </Link>
        <Link
          data-testid="link-hover-legacy"
          href="/about?mode=hover-legacy"
          prefetch="hover"
          prefetchDelay={20}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          Hover (legacy)
        </Link>
        <Link
          data-testid="link-none"
          href="/about?mode=none"
          prefetch="none"
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          No prefetch
        </Link>
        <Link
          data-testid="link-external"
          href="https://example.com"
          prefetch="render"
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          External link
        </Link>
      </div>

      <div className="rounded border border-slate-200 bg-slate-50 p-4">
        <button
          data-testid="clear-logs"
          className="rounded bg-slate-900 px-3 py-2 text-sm text-white"
          onClick={() => {
            window.__FARM_PREFETCH_E2E__?.clear();
            setTick((v) => v + 1);
          }}
          type="button"
        >
          Clear logs
        </button>
        <button
          data-testid="refresh-logs"
          className="ml-2 rounded border border-slate-300 px-3 py-2 text-sm"
          onClick={() => setTick((v) => v + 1)}
          type="button"
        >
          Refresh logs
        </button>
        <pre data-testid="prefetch-logs" className="mt-3 overflow-x-auto text-xs text-slate-700">
          {JSON.stringify(logs, null, 2)}
        </pre>
      </div>

      <div className="h-[1400px] rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">
        Scroll down to trigger viewport prefetch
      </div>

      <Link
        data-testid="link-viewport"
        href="/about?mode=viewport"
        prefetch="viewport"
        className="inline-block rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
      >
        Viewport prefetch target
      </Link>

      <div className="h-[1000px]" />

      <Link
        data-testid="link-true"
        href="/about?mode=true"
        prefetch={true}
        className="inline-block rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-700"
      >
        Prefetch true target
      </Link>
    </div>
  );
}
