import type { RetryOptions } from "./api/client";

/**
 * Retry a server-function mutation with the API client's retry shape.
 *
 * Attempts run until success, until `count` retries are exhausted, or until
 * `shouldContinue` reports that the owning lifecycle was reset. The delay
 * callback receives the upcoming attempt number starting at 1, matching the
 * API client. Defaults to zero retries so existing behavior is unchanged.
 */
export async function invokeMutationWithRetry<T>(
  invoke: () => Promise<T>,
  retry: RetryOptions | undefined,
  shouldContinue: () => boolean,
): Promise<T> {
  const maxRetries = Math.max(0, retry?.count ?? 0);
  let attempt = 0;

  while (true) {
    try {
      return await invoke();
    } catch (error) {
      if (attempt >= maxRetries || !shouldContinue()) throw error;

      attempt += 1;
      const delay = typeof retry?.delay === "function" ? retry.delay(attempt) : (retry?.delay ?? 0);
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        // The lifecycle may have been reset while this attempt waited.
        if (!shouldContinue()) throw error;
      }
    }
  }
}
