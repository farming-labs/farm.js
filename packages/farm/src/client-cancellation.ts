/** One call budget, shared by header resolution, dispatch, decoding, and retry waits. */
export function createClientCancellation(
  signal?: AbortSignal,
  timeoutMs = 0,
  parent?: AbortSignal,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let invalid: Error | undefined;
  let timeoutReason: DOMException | undefined;
  const signals = [signal, parent].filter((value): value is AbortSignal => !!value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) {
    invalid = new RangeError(
      "timeoutMs must be an integer between 0 and 2147483647 (0 disables the deadline).",
    );
  } else if (timeoutMs > 0) {
    const controller = new AbortController();
    signals.push(controller.signal);
    timer = setTimeout(() => {
      timeoutReason = new DOMException("Client request timed out", "TimeoutError");
      controller.abort(timeoutReason);
    }, timeoutMs);
  }
  const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  let active = 0;
  let closed = false;
  const cleanup = () => {
    if (closed && active === 0 && timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const check = () => {
    if (invalid) throw invalid;
    combined?.throwIfAborted();
  };
  return {
    signal: combined,
    get timedOut() {
      return timeoutReason !== undefined && combined?.reason === timeoutReason;
    },
    check,
    hold() {
      active++;
      return () => {
        active--;
        cleanup();
      };
    },
    // A race also bounds cooperative local dispatch and custom HTTP implementations.
    // Late completion is consumed, but cannot turn a cancelled result into success.
    async run<T>(work: () => T | PromiseLike<T>): Promise<T> {
      check();
      active++;
      let abort: (() => void) | undefined;
      try {
        if (!combined) return await work();
        return await new Promise<T>((resolve, reject) => {
          abort = () => reject(combined.reason);
          combined.addEventListener("abort", abort, { once: true });
          Promise.resolve()
            .then(() => {
              check();
              return work();
            })
            .then(resolve, reject);
        });
      } finally {
        if (abort) combined?.removeEventListener("abort", abort);
        active--;
        cleanup();
      }
    },
    async delay(ms: number) {
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await this.run(
          () =>
            new Promise<void>((resolve) => {
              retryTimer = setTimeout(resolve, ms);
            }),
        );
      } finally {
        if (retryTimer !== undefined) clearTimeout(retryTimer);
      }
    },
    dispose() {
      closed = true;
      cleanup();
    },
  };
}
