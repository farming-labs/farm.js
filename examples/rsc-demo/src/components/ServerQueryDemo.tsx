"use client";

import { useState } from "react";
import { useServerFn } from "@farmjs/core/server-fn/client";
import {
  prefetchServerQuery,
  useServerQuery,
} from "@farmjs/core/server-query/client";
import { productQuery, updateProduct } from "../actions/server-query";

const input = { id: "123" } as const;

function ProductResult({ testId }: { testId: string }) {
  const query = useServerQuery(productQuery, input);

  return (
    <output data-testid={testId} className="block min-h-6 text-sm text-slate-300">
      {query.error
        ? `error:${query.error.message}`
        : query.data
          ? JSON.stringify(query.data)
          : query.status}
    </output>
  );
}

export function ServerQueryDemo() {
  const [showConsumers, setShowConsumers] = useState(false);
  const [prefetchStatus, setPrefetchStatus] = useState("idle");
  const update = useServerFn(updateProduct);

  return (
    <section className="space-y-5" aria-labelledby="server-query-actions">
      <h2 id="server-query-actions" className="text-xl font-semibold text-emerald-400">
        Query lifecycle
      </h2>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="prefetch-product-query"
          onClick={async () => {
            setPrefetchStatus("pending");
            const product = await prefetchServerQuery(productQuery, input);
            setPrefetchStatus(`prefetched:${product.version}:${product.queryCalls}`);
          }}
          className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          Prefetch product
        </button>

        <button
          type="button"
          data-testid="show-product-consumers"
          onClick={() => setShowConsumers(true)}
          className="rounded border border-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-950"
        >
          Show consumers
        </button>

        <button
          type="button"
          data-testid="update-product-query"
          onClick={() => update.submit(input)}
          className="rounded border border-sky-500 px-3 py-2 text-sm font-semibold text-sky-300 hover:bg-sky-950"
        >
          Update product
        </button>
      </div>

      <output data-testid="product-prefetch-status" className="block text-sm text-slate-400">
        {prefetchStatus}
      </output>

      {showConsumers ? (
        <div className="space-y-2">
          <ProductResult testId="product-query-first" />
          <ProductResult testId="product-query-second" />
        </div>
      ) : null}
    </section>
  );
}
