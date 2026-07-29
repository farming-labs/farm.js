"use client";

import { useServerFn } from "@farm.js/core/server-fn/client";
import { inspectServerMiddleware } from "../actions/middleware";

export function MiddlewareActions() {
  const action = useServerFn(inspectServerMiddleware);

  return (
    <section className="space-y-5" aria-labelledby="server-middleware-actions">
      <h2 id="server-middleware-actions" className="text-xl font-semibold text-orange-400">
        Action calls
      </h2>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="call-server-middleware"
          onClick={() => action.submit({ message: "browser middleware" })}
          className="rounded bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-500"
        >
          Call from browser
        </button>

        <form action={action.formAction} className="flex gap-2">
          <input type="hidden" name="message" value="form middleware" />
          <button
            type="submit"
            data-testid="submit-server-middleware-form"
            className="rounded border border-orange-500 px-3 py-2 text-sm font-semibold text-orange-300 hover:bg-orange-950"
          >
            Submit form
          </button>
        </form>
      </div>

      <output
        data-testid="server-middleware-result"
        className="block min-h-6 break-words text-sm text-slate-300"
      >
        {action.error
          ? JSON.stringify({ error: action.error.message })
          : action.result
            ? JSON.stringify(action.result)
            : action.status}
      </output>
    </section>
  );
}
