/** Metadata shared by app-route and integration execution attempts. */
export type ClientRequestEvent = {
  requestId: string;
  method: string;
  path: string;
  attempt: number;
  timestamp: number;
};

export type ClientResponseEvent<TData = unknown> = ClientRequestEvent & {
  response?: Response;
  data?: TData;
  error?: Error;
  ok?: boolean;
  status?: number;
};

/** Observers compose with per-call hooks; return values never replace the result. */
export type ClientLifecycleHooks<TData = unknown> = {
  onRequest?: (event: ClientRequestEvent) => void;
  onResponse?: (
    data: TData | undefined,
    error: Error | null,
    event: ClientResponseEvent<TData>,
  ) => void;
  onError?: (error: Error) => void;
};

export function notifyClientObserver(
  observer: ((...args: any[]) => unknown) | undefined,
  args: unknown[],
  label = "Client lifecycle",
): void {
  if (!observer) return;
  const report = (error: unknown) => {
    const reportError = (
      globalThis as typeof globalThis & { reportError?: (error: unknown) => void }
    ).reportError;
    if (typeof reportError === "function") {
      try {
        reportError.call(globalThis, error);
        return;
      } catch {
        /* Try the console fallback. */
      }
    }
    try {
      console.error(`[Farm.js] ${label} callback failed:`, error);
    } catch {
      /* Reporting must not affect a call. */
    }
  };
  try {
    const result = observer(...args);
    if (result && typeof (result as PromiseLike<unknown>).then === "function")
      void Promise.resolve(result).catch(report);
  } catch (error) {
    report(error);
  }
}
