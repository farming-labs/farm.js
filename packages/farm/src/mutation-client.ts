"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  applyServerFnOptimisticUpdates,
  isAPIRouteRef,
  resolveServerFnInvalidateTargets,
  settleServerFnOptimisticUpdates,
  type APIResult,
  type ClientOptions,
} from "./api/client";
import { notifyFarmCacheInvalidation } from "./cache-invalidation";
import { isNavigatorOnline, subscribeOnline } from "./client-network-status";
import { notifyClientObserver } from "./client-observers";
import { invokeMutationWithRetry } from "./mutation-retry";

export type MutationStatus = "idle" | "pending" | "success" | "error";

export type AnyMutationTarget = (...args: any[]) => Promise<any>;

export type InferMutationVariables<TTarget extends AnyMutationTarget> =
  Parameters<TTarget> extends [] ? undefined : Parameters<TTarget>[0];

export type InferMutationData<TTarget extends AnyMutationTarget> = TTarget extends {
  readonly __farmRouteData: infer TData;
}
  ? TData
  : Awaited<ReturnType<TTarget>>;

export type InferMutationError<TTarget extends AnyMutationTarget> = TTarget extends {
  readonly __farmServerFnError: infer TError;
}
  ? TError
  : TTarget extends (...args: any[]) => Promise<APIResult<any, infer TError>>
    ? TError
    : Error;

export type MutationOptimisticContext<TVariables, TData> = {
  variables: TVariables | undefined;
  current: TData | null;
};

export type MutationNetworkMode = "always" | "online";

export type UseMutationOptions<TVariables, TData, TError = Error> = {
  initialData?: TData | null;
  resetOnMutate?: boolean;
  /**
   * `"always"` (default) dispatches regardless of connectivity, preserving
   * existing behavior. `"online"` pauses a submission while the browser is
   * offline — including one whose dispatch failed while offline — and resumes
   * it on the `online` event instead of failing it.
   */
  networkMode?: MutationNetworkMode;
  optimistic?: (context: MutationOptimisticContext<TVariables, TData>) => TData | null | undefined;
  rollbackOnError?: boolean;
  /**
   * Options forwarded to generated `api.route.method` clients.
   * Server-function targets honor `request.retry`, key-targeted
   * `request.optimistic` updates, and key-targeted `request.invalidate`;
   * the remaining request options apply to API routes only.
   */
  request?: ClientOptions<TData, TError>;
  onSuccess?: (data: TData, variables: TVariables | undefined) => void;
  onError?: (error: TError, variables: TVariables | undefined) => void;
  onSettled?: (data: TData | null, error: TError | null, variables: TVariables | undefined) => void;
};

type MutationInput<TTarget extends AnyMutationTarget> = InferMutationVariables<TTarget>;

type MutationData<TTarget extends AnyMutationTarget> = InferMutationData<TTarget>;

type MutationError<TTarget extends AnyMutationTarget> = InferMutationError<TTarget>;

export type MutationAsync<TTarget extends AnyMutationTarget, TData = MutationData<TTarget>> =
  [] extends Parameters<TTarget>
    ? (variables?: MutationInput<TTarget>) => Promise<TData>
    : (variables: MutationInput<TTarget>) => Promise<TData>;

export type MutationTrigger<TTarget extends AnyMutationTarget> =
  [] extends Parameters<TTarget>
    ? (variables?: MutationInput<TTarget>) => void
    : (variables: MutationInput<TTarget>) => void;

export type UseMutationReturn<
  TTarget extends AnyMutationTarget,
  TData = MutationData<TTarget>,
  TError = MutationError<TTarget>,
> = {
  pending: boolean;
  /** True while a submission is waiting for the browser to come back online. */
  paused: boolean;
  status: MutationStatus;
  data: TData | null;
  error: TError | null;
  variables: MutationInput<TTarget> | undefined;
  mutate: MutationTrigger<TTarget>;
  mutateAsync: MutationAsync<TTarget, TData>;
  reset: () => void;
};

type MutationState<TVariables, TData, TError> = {
  pendingCount: number;
  pausedCount: number;
  status: MutationStatus;
  data: TData | null;
  error: TError | null;
  variables: TVariables | undefined;
};

/**
 * Track a generated API route mutation or a Farm server function with one
 * React lifecycle.
 *
 * API routes keep using their existing fetch transport and request options.
 * Server functions keep using their configured server-function transport.
 */
export function useMutation<TTarget extends AnyMutationTarget>(
  target: TTarget,
  options: UseMutationOptions<
    MutationInput<TTarget>,
    MutationData<TTarget>,
    MutationError<TTarget>
  > = {},
): UseMutationReturn<TTarget> {
  return useMutationLifecycle(target, options).mutation;
}

/** Internal shared lifecycle: fetchers prepare form input before dispatch. */
export function useMutationLifecycle<
  TTarget extends AnyMutationTarget,
  TError = MutationError<TTarget>,
>(
  target: TTarget,
  options: Omit<
    UseMutationOptions<MutationInput<TTarget>, MutationData<TTarget>, TError>,
    "request"
  > & {
    request?: ClientOptions<MutationData<TTarget>, MutationError<TTarget>>;
  } = {},
) {
  type TVariables = MutationInput<TTarget>;
  type TData = MutationData<TTarget>;

  const initialData = options.initialData ?? null;
  const optionsRef = useRef(options);
  const targetRef = useRef(target);
  const requestIdRef = useRef(0);
  const lastResetIdRef = useRef(0);
  const initialState: MutationState<TVariables, TData, TError> = {
    pendingCount: 0,
    pausedCount: 0,
    status: "idle",
    data: initialData,
    error: null,
    variables: undefined,
  };
  const stateRef = useRef(initialState);
  const resetWakersRef = useRef(new Set<() => void>());
  const [state, setState] = useState<MutationState<TVariables, TData, TError>>(initialState);

  optionsRef.current = options;
  targetRef.current = target;

  const setMutationState = useCallback(
    (
      value:
        | MutationState<TVariables, TData, TError>
        | ((
            current: MutationState<TVariables, TData, TError>,
          ) => MutationState<TVariables, TData, TError>),
    ) => {
      // Advance the authoritative snapshot before React processes its queue.
      // A second submission in this batch must see the preceding transition.
      const next = typeof value === "function" ? value(stateRef.current) : value;
      stateRef.current = next;
      setState(next);
    },
    [],
  );

  const waitForReconnect = useCallback(
    async (requestId: number) => {
      while (!isNavigatorOnline()) {
        if (requestId < lastResetIdRef.current) return;
        setMutationState((current) => ({ ...current, pausedCount: current.pausedCount + 1 }));
        try {
          await new Promise<void>((resolve) => {
            const wake = () => {
              unsubscribe();
              resetWakersRef.current.delete(wake);
              resolve();
            };
            const unsubscribe = subscribeOnline(wake);
            resetWakersRef.current.add(wake);
          });
        } finally {
          setMutationState((current) => ({
            ...current,
            pausedCount: Math.max(0, current.pausedCount - 1),
          }));
        }
      }
    },
    [setMutationState],
  );

  const mutatePreparedAsync = useCallback(
    async (prepare: () => TVariables | undefined) => {
      const requestId = ++requestIdRef.current;
      const currentOptions = optionsRef.current;
      const previousData = stateRef.current.data;
      let variables: TVariables | undefined;
      let preparationFailed = false;
      let preparationError: unknown;
      try {
        variables = prepare();
      } catch (error) {
        preparationFailed = true;
        preparationError = error;
      }
      const optimisticData = preparationFailed
        ? undefined
        : currentOptions.optimistic?.({ variables, current: previousData });
      const hasOptimisticData = optimisticData !== undefined;

      setMutationState((current) => {
        // Preparation is app code and may reset or submit again synchronously.
        if (requestId < lastResetIdRef.current) return current;
        const pendingCount = current.pendingCount + 1;
        if (requestId !== requestIdRef.current) return { ...current, pendingCount };
        return {
          pendingCount,
          pausedCount: current.pausedCount,
          status: "pending",
          data: hasOptimisticData
            ? optimisticData
            : currentOptions.resetOnMutate === false
              ? current.data
              : null,
          error: null,
          variables,
        };
      });

      const mutationTarget = targetRef.current;
      const isAPITarget = isAPIRouteRef(mutationTarget);
      // API routes run their own cache-layered optimistic engine; server
      // functions apply key-targeted updates to the shared cache here.
      const sharedOptimistic =
        !preparationFailed && !isAPITarget ? currentOptions.request?.optimistic : undefined;
      const sharedSnapshots = sharedOptimistic?.update?.length
        ? applyServerFnOptimisticUpdates(sharedOptimistic.update)
        : [];

      try {
        if (preparationFailed) throw preparationError;
        let data!: TData;
        while (true) {
          if (currentOptions.networkMode === "online") {
            await waitForReconnect(requestId);
            if (requestId < lastResetIdRef.current) {
              throw new Error("Mutation reset while waiting for reconnection");
            }
          }
          try {
            const rawResult = isAPITarget
              ? await mutationTarget(variables, currentOptions.request)
              : await invokeMutationWithRetry(
                  () => targetRef.current(variables),
                  currentOptions.request?.retry,
                  // A reset disowns this submission; stop scheduling retries then.
                  () => requestId >= lastResetIdRef.current,
                );
            data = unwrapMutationResult<TData, TError>(rawResult, isAPITarget);
            break;
          } catch (cause) {
            // A dispatch that failed *because of connectivity* while offline
            // pauses and rides the next reconnect. An application error (a
            // typed business failure from a request that reached the server)
            // must surface instead, or it would be swallowed and the payload
            // silently re-submitted on reconnect, duplicating a non-idempotent
            // write.
            if (
              currentOptions.networkMode === "online" &&
              !isNavigatorOnline() &&
              requestId >= lastResetIdRef.current &&
              isConnectivityFailure(cause)
            ) {
              continue;
            }
            throw cause;
          }
        }

        settleServerFnOptimisticUpdates(sharedSnapshots, "commit");
        if (!isAPITarget && currentOptions.request?.invalidate) {
          // Server-function invalidations travel the shared bus, matching
          // server-declared `invalidates`, so every subscribed cache observes them.
          for (const key of resolveServerFnInvalidateTargets(currentOptions.request.invalidate)) {
            notifyFarmCacheInvalidation(key);
          }
        }

        const isLatestRequest = requestId === requestIdRef.current;

        setMutationState((current) => {
          if (requestId < lastResetIdRef.current) return current;
          const pendingCount = Math.max(0, current.pendingCount - 1);
          if (!isLatestRequest) {
            return {
              ...current,
              pendingCount,
            };
          }

          return {
            pendingCount,
            pausedCount: current.pausedCount,
            status: "success",
            data,
            error: null,
            variables,
          };
        });

        if (isLatestRequest) {
          notifyClientObserver(currentOptions.onSuccess, [data, variables], "Mutation onSuccess");
          if (requestId === requestIdRef.current) {
            notifyClientObserver(
              currentOptions.onSettled,
              [data, null, variables],
              "Mutation onSettled",
            );
          }
        }

        return data;
      } catch (cause) {
        settleServerFnOptimisticUpdates(
          sharedSnapshots,
          sharedOptimistic?.rollbackOnError ? "rollback" : "invalidate",
        );
        const error = normalizeMutationError(cause) as TError;
        const isLatestRequest = requestId === requestIdRef.current;

        setMutationState((current) => {
          if (requestId < lastResetIdRef.current) return current;
          const pendingCount = Math.max(0, current.pendingCount - 1);
          if (!isLatestRequest) {
            return {
              ...current,
              pendingCount,
            };
          }

          return {
            pendingCount,
            pausedCount: current.pausedCount,
            status: "error",
            data:
              hasOptimisticData && currentOptions.rollbackOnError
                ? previousData
                : currentOptions.resetOnMutate === false
                  ? current.data
                  : null,
            error,
            variables,
          };
        });

        if (isLatestRequest) {
          notifyClientObserver(currentOptions.onError, [error, variables], "Mutation onError");
          if (requestId === requestIdRef.current) {
            notifyClientObserver(
              currentOptions.onSettled,
              [null, error, variables],
              "Mutation onSettled",
            );
          }
        }

        throw error;
      }
    },
    [setMutationState, waitForReconnect],
  );

  const mutateAsync = useCallback(
    (variables?: TVariables) => mutatePreparedAsync(() => variables),
    [mutatePreparedAsync],
  ) as MutationAsync<TTarget, TData>;

  const mutate = useCallback(
    (variables?: TVariables) => {
      void mutateAsync(variables as never).catch(() => {});
    },
    [mutateAsync],
  ) as MutationTrigger<TTarget>;

  const reset = useCallback(() => {
    // Pre-reset requests no longer own any of the current pending count.
    lastResetIdRef.current = ++requestIdRef.current;
    setMutationState({
      pendingCount: 0,
      pausedCount: 0,
      status: "idle",
      data: optionsRef.current.initialData ?? null,
      error: null,
      variables: undefined,
    });
    // Wake paused submissions so they reject instead of waiting for `online`.
    const wakers = Array.from(resetWakersRef.current);
    resetWakersRef.current.clear();
    for (const wake of wakers) wake();
  }, [setMutationState]);

  const mutation: UseMutationReturn<TTarget, TData, TError> = useMemo(
    () => ({
      pending: state.pendingCount > 0,
      paused: state.pausedCount > 0,
      status: state.status,
      data: state.data,
      error: state.error,
      variables: state.variables,
      mutate,
      mutateAsync,
      reset,
    }),
    [
      mutate,
      mutateAsync,
      reset,
      state.data,
      state.error,
      state.pausedCount,
      state.pendingCount,
      state.status,
      state.variables,
    ],
  );
  return { mutation, mutatePreparedAsync };
}

/**
 * Whether a thrown value represents a connectivity failure (as opposed to an
 * application/business error). Only connectivity failures are safe to pause and
 * retry on reconnect; an application error means the request reached the server
 * and produced a real result. The client tags transport failures with an
 * `APIClientError` code of `network_error` or `timeout`; a raw fetch/transport
 * failure surfaces as a `TypeError`.
 */
function isConnectivityFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === "network_error" || code === "timeout";
}

function unwrapMutationResult<TData, TError>(result: unknown, apiRoute: boolean): TData {
  if (!apiRoute) return result as TData;

  const apiResult = result as APIResult<TData, TError>;
  if (apiResult.error) {
    throw apiResult.error;
  }

  return apiResult.data as TData;
}

function normalizeMutationError(error: unknown): Error {
  if (error instanceof Error) return error;

  const normalized = new Error(typeof error === "string" ? error : "Mutation failed");
  (normalized as Error & { cause?: unknown }).cause = error;
  return normalized;
}
