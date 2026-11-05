"use client";
import { useState } from "react";
import { useServerFn } from "@farm.js/core/server-fn/client";
import { prefetchServerQuery, useServerQuery } from "@farm.js/core/server-query/client";
import { inspectMiddleware } from "../server/middleware-fn";
import { productQuery, updateProduct } from "../server/query";

export function MiddlewareCalls() {
  const action = useServerFn(inspectMiddleware);
  return (
    <div>
      <button type="button" onClick={() => action.submit({ message: "from the browser" })}>
        Call with middleware
      </button>
      <form action={action.formAction}>
        <input type="hidden" name="message" value="from a form" />
        <button type="submit">Submit with middleware</button>
      </form>
      <output data-testid="middleware-result">
        {action.error ? `error:${action.error.message}` : action.result ? JSON.stringify(action.result) : action.status}
      </output>
    </div>
  );
}

const input = { id: "7" } as const;

function Product({ testId }: { testId: string }) {
  const query = useServerQuery(productQuery, input);
  return (
    <output data-testid={testId}>
      {query.error ? `error:${query.error.message}` : query.data ? JSON.stringify(query.data) : query.status}
    </output>
  );
}

export function ProductQueries() {
  const [shown, setShown] = useState(false);
  const [prefetched, setPrefetched] = useState("idle");
  const update = useServerFn(updateProduct);
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const product = await prefetchServerQuery(productQuery, input);
          setPrefetched(`prefetched:${product.version}:${product.calls}`);
        }}
      >
        Prefetch product
      </button>
      <output data-testid="prefetch-status">{prefetched}</output>
      <button type="button" onClick={() => setShown(true)}>
        Show products
      </button>
      <button type="button" onClick={() => update.submit(input)}>
        Update product
      </button>
      {shown ? (
        <>
          <Product testId="product-first" />
          <Product testId="product-second" />
        </>
      ) : null}
    </div>
  );
}
