type ErrorHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtils {
  getGlobalHandler(): ErrorHandler | undefined;
  setGlobalHandler(handler: ErrorHandler): void;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * Runs a screen's lazy `require`. Metro does not throw when a module fails to evaluate: its
 * `require` reports the error to `ErrorUtils` as fatal and returns `undefined`. This records what
 * was reported (still passing it on, so dev keeps React Native's error screen) and throws an error
 * that names the module and the original error.
 */
export function loadFarmScreen<Module extends object>(
  module: string,
  load: () => Module | undefined,
): Module {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtils }).ErrorUtils;
  const previous = errorUtils?.getGlobalHandler();
  let reported: { error: unknown } | undefined;
  errorUtils?.setGlobalHandler((error, isFatal) => {
    reported ??= { error };
    previous?.(error, isFatal);
  });
  let loaded: Module | undefined;
  let failure: { error: unknown } | undefined;
  try {
    loaded = load();
    failure = reported;
  } catch (error) {
    failure = { error };
  } finally {
    if (errorUtils) errorUtils.setGlobalHandler(previous as ErrorHandler);
  }
  if (failure) {
    throw new Error(`${module} failed to load: ${describeError(failure.error)}`, {
      cause: failure.error,
    });
  }
  if (loaded == null) {
    throw new Error(`${module} failed to load: its module evaluated to ${String(loaded)}.`);
  }
  return loaded;
}
