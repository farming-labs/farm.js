"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ServerFn } from "./server-fn";

export type ServerFnActionStatus = "idle" | "pending" | "success" | "error";

export type ServerFnSubmit<TInput, TResult> = [unknown] extends [TInput]
  ? (input?: TInput | FormData) => Promise<TResult>
  : (input: TInput | FormData) => Promise<TResult>;

export type ServerFnOptimisticContext<TInput, TResult> = {
  input: TInput | FormData | undefined;
  formData?: FormData;
  current: TResult | null;
};

export type UseServerFnOptions<TResult, TError extends Error = Error, TInput = unknown> = {
  initialResult?: TResult | null;
  resetOnSubmit?: boolean;
  throwOnFormError?: boolean;
  optimistic?: (context: ServerFnOptimisticContext<TInput, TResult>) => TResult | null | undefined;
  rollbackOnError?: boolean;
  onSuccess?: (result: TResult) => void;
  onError?: (error: TError) => void;
  onSettled?: (result: TResult | null, error: TError | null) => void;
};

export type UseServerFnReturn<TInput, TResult, TError extends Error = Error> = {
  pending: boolean;
  status: ServerFnActionStatus;
  result: TResult | null;
  error: TError | null;
  submit: ServerFnSubmit<TInput, TResult>;
  formAction: (formData: FormData) => Promise<void>;
  reset: () => void;
};

type ServerFnActionState<TResult, TError extends Error> = {
  pendingCount: number;
  status: ServerFnActionStatus;
  result: TResult | null;
  error: TError | null;
};

type ServerFnActionCallbacks<TResult, TError extends Error> = Pick<
  UseServerFnOptions<TResult, TError, unknown>,
  "onError" | "onSettled" | "onSuccess" | "throwOnFormError"
>;

export function useServerFn<TInput, TResult, TError extends Error = Error>(
  serverFn: ServerFn<TInput, TResult, TError>,
  options: UseServerFnOptions<TResult, TError, TInput> = {},
): UseServerFnReturn<TInput, TResult, TError> {
  const { initialResult = null, resetOnSubmit = true } = options;
  const callbacksRef = useRef<ServerFnActionCallbacks<TResult, TError>>({});
  const requestIdRef = useRef(0);
  const initialState: ServerFnActionState<TResult, TError> = {
    pendingCount: 0,
    status: "idle",
    result: initialResult,
    error: null,
  };
  const stateRef = useRef<ServerFnActionState<TResult, TError>>(initialState);
  const [state, setState] = useState<ServerFnActionState<TResult, TError>>(initialState);
  const setActionState = useCallback(
    (
      value:
        | ServerFnActionState<TResult, TError>
        | ((current: ServerFnActionState<TResult, TError>) => ServerFnActionState<TResult, TError>),
    ) => {
      setState((current) => {
        const next = typeof value === "function" ? value(current) : value;
        stateRef.current = next;
        return next;
      });
    },
    [],
  );

  callbacksRef.current = {
    onError: options.onError,
    onSettled: options.onSettled,
    onSuccess: options.onSuccess,
    throwOnFormError: options.throwOnFormError,
  };

  const submit = useCallback(
    async (input?: TInput | FormData) => {
      const requestId = ++requestIdRef.current;
      const formData = isFormData(input) ? input : undefined;
      const previousResult = stateRef.current.result;
      const optimisticResult = options.optimistic?.({
        input,
        formData,
        current: previousResult,
      });
      const hasOptimisticResult = optimisticResult !== undefined;

      setActionState((current) => ({
        pendingCount: current.pendingCount + 1,
        status: "pending",
        result: hasOptimisticResult ? optimisticResult : resetOnSubmit ? null : current.result,
        error: null,
      }));

      try {
        const result = await serverFn(input as TInput | FormData);
        const isLatestRequest = requestId === requestIdRef.current;

        setActionState((current) => {
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
            status: pendingCount > 0 ? "pending" : "success",
            result,
            error: null,
          };
        });

        if (isLatestRequest) {
          callbacksRef.current.onSuccess?.(result);
          callbacksRef.current.onSettled?.(result, null);
        }

        return result;
      } catch (cause) {
        const error = normalizeServerFnError(cause) as TError;
        const isLatestRequest = requestId === requestIdRef.current;

        setActionState((current) => {
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
            status: pendingCount > 0 ? "pending" : "error",
            result:
              hasOptimisticResult && options.rollbackOnError
                ? previousResult
                : resetOnSubmit
                  ? null
                  : current.result,
            error,
          };
        });

        if (isLatestRequest) {
          callbacksRef.current.onError?.(error);
          callbacksRef.current.onSettled?.(null, error);
        }

        throw error;
      }
    },
    [options.optimistic, options.rollbackOnError, resetOnSubmit, serverFn, setActionState],
  ) as ServerFnSubmit<TInput, TResult>;

  const formAction = useCallback(
    async (formData: FormData) => {
      try {
        await submit(formData as TInput | FormData);
      } catch (error) {
        if (callbacksRef.current.throwOnFormError) {
          throw error;
        }
      }
    },
    [submit],
  );

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setActionState({
      pendingCount: 0,
      status: "idle",
      result: initialResult,
      error: null,
    });
  }, [initialResult, setActionState]);

  return useMemo(
    () => ({
      pending: state.pendingCount > 0,
      status: state.status,
      result: state.result,
      error: state.error,
      submit,
      formAction,
      reset,
    }),
    [formAction, reset, state.error, state.pendingCount, state.result, state.status, submit],
  );
}

function normalizeServerFnError(error: unknown) {
  if (error instanceof Error) return error;

  const normalized = new Error(typeof error === "string" ? error : "Server function failed");
  (normalized as Error & { cause?: unknown }).cause = error;
  return normalized;
}

function isFormData(value: unknown): value is FormData {
  if (!value || typeof value !== "object") return false;

  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return true;
  }

  return (
    Object.prototype.toString.call(value) === "[object FormData]" &&
    typeof (value as { entries?: unknown }).entries === "function"
  );
}
