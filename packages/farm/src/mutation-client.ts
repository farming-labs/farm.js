"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { isAPIRouteRef, type APIResult, type ClientOptions } from "./api/client";

export type MutationStatus = "idle" | "pending" | "success" | "error";

export type AnyMutationTarget = (...args: any[]) => Promise<any>;

export type InferMutationVariables<TTarget extends AnyMutationTarget> =
  Parameters<TTarget> extends [] ? undefined : Parameters<TTarget>[0];

export type InferMutationData<TTarget extends AnyMutationTarget> = TTarget extends {
  readonly __farmRouteData: infer TData;
}
  ? TData
  : Awaited<ReturnType<TTarget>>;

export type InferMutationError<TTarget extends AnyMutationTarget> = TTarget extends (
  ...args: any[]
) => Promise<APIResult<any, infer TError>>
  ? TError
  : Error;

export type MutationOptimisticContext<TVariables, TData> = {
  variables: TVariables | undefined;
  current: TData | null;
};

export type UseMutationOptions<TVariables, TData, TError = Error> = {
  initialData?: TData | null;
  resetOnMutate?: boolean;
  optimistic?: (context: MutationOptimisticContext<TVariables, TData>) => TData | null | undefined;
  rollbackOnError?: boolean;
  /**
   * Options forwarded to generated `api.route.method` clients.
   * Server functions ignore this field.
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
  type TVariables = MutationInput<TTarget>;
  type TData = MutationData<TTarget>;
  type TError = MutationError<TTarget>;

  const initialData = options.initialData ?? null;
  const optionsRef = useRef(options);
  const targetRef = useRef(target);
  const requestIdRef = useRef(0);
  const initialState: MutationState<TVariables, TData, TError> = {
    pendingCount: 0,
    status: "idle",
    data: initialData,
    error: null,
    variables: undefined,
  };
  const stateRef = useRef(initialState);
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
      setState((current) => {
        const next = typeof value === "function" ? value(current) : value;
        stateRef.current = next;
        return next;
      });
    },
    [],
  );

  const mutateAsync = useCallback(
    async (variables?: TVariables) => {
      const requestId = ++requestIdRef.current;
      const currentOptions = optionsRef.current;
      const previousData = stateRef.current.data;
      const optimisticData = currentOptions.optimistic?.({
        variables,
        current: previousData,
      });
      const hasOptimisticData = optimisticData !== undefined;

      setMutationState((current) => ({
        pendingCount: current.pendingCount + 1,
        status: "pending",
        data: hasOptimisticData
          ? optimisticData
          : currentOptions.resetOnMutate === false
            ? current.data
            : null,
        error: null,
        variables,
      }));

      try {
        const mutationTarget = targetRef.current;
        const rawResult = isAPIRouteRef(mutationTarget)
          ? await mutationTarget(variables, currentOptions.request)
          : await mutationTarget(variables);
        const data = unwrapMutationResult<TData, TError>(rawResult, isAPIRouteRef(mutationTarget));
        const isLatestRequest = requestId === requestIdRef.current;

        setMutationState((current) => {
          const pendingCount = Math.max(0, current.pendingCount - 1);
          if (!isLatestRequest) {
            return {
              ...current,
              pendingCount,
              status: pendingCount > 0 ? "pending" : current.status,
            };
          }

          return {
            pendingCount,
            status: "success",
            data,
            error: null,
            variables,
          };
        });

        if (isLatestRequest) {
          currentOptions.onSuccess?.(data, variables);
          currentOptions.onSettled?.(data, null, variables);
        }

        return data;
      } catch (cause) {
        const error = normalizeMutationError(cause) as TError;
        const isLatestRequest = requestId === requestIdRef.current;

        setMutationState((current) => {
          const pendingCount = Math.max(0, current.pendingCount - 1);
          if (!isLatestRequest) {
            return {
              ...current,
              pendingCount,
              status: pendingCount > 0 ? "pending" : current.status,
            };
          }

          return {
            pendingCount,
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
          currentOptions.onError?.(error, variables);
          currentOptions.onSettled?.(null, error, variables);
        }

        throw error;
      }
    },
    [setMutationState],
  ) as MutationAsync<TTarget, TData>;

  const mutate = useCallback(
    (variables?: TVariables) => {
      void mutateAsync(variables as never).catch(() => {});
    },
    [mutateAsync],
  ) as MutationTrigger<TTarget>;

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setMutationState({
      pendingCount: 0,
      status: "idle",
      data: optionsRef.current.initialData ?? null,
      error: null,
      variables: undefined,
    });
  }, [setMutationState]);

  return useMemo(
    () => ({
      pending: state.pendingCount > 0,
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
      state.pendingCount,
      state.status,
      state.variables,
    ],
  );
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
