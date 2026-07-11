"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ServerFn } from "./server-fn";

export type ServerFnActionStatus = "idle" | "pending" | "success" | "error";

export type ServerFnSubmit<TInput, TResult> = [unknown] extends [TInput]
  ? (input?: TInput | FormData) => Promise<TResult>
  : (input: TInput | FormData) => Promise<TResult>;

export type UseServerFnOptions<TResult, TError extends Error = Error> = {
  initialResult?: TResult | null;
  resetOnSubmit?: boolean;
  throwOnFormError?: boolean;
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
  UseServerFnOptions<TResult, TError>,
  "onError" | "onSettled" | "onSuccess" | "throwOnFormError"
>;

export function useServerFn<TInput, TResult, TError extends Error = Error>(
  serverFn: ServerFn<TInput, TResult>,
  options: UseServerFnOptions<TResult, TError> = {},
): UseServerFnReturn<TInput, TResult, TError> {
  const { initialResult = null, resetOnSubmit = true } = options;
  const callbacksRef = useRef<ServerFnActionCallbacks<TResult, TError>>({});
  const requestIdRef = useRef(0);
  const [state, setState] = useState<ServerFnActionState<TResult, TError>>({
    pendingCount: 0,
    status: "idle",
    result: initialResult,
    error: null,
  });

  callbacksRef.current = {
    onError: options.onError,
    onSettled: options.onSettled,
    onSuccess: options.onSuccess,
    throwOnFormError: options.throwOnFormError,
  };

  const submit = useCallback(
    async (input?: TInput | FormData) => {
      const requestId = ++requestIdRef.current;

      setState((current) => ({
        pendingCount: current.pendingCount + 1,
        status: "pending",
        result: resetOnSubmit ? null : current.result,
        error: null,
      }));

      try {
        const result = await serverFn(input as TInput | FormData);
        const isLatestRequest = requestId === requestIdRef.current;

        setState((current) => {
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

        setState((current) => {
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
            result: resetOnSubmit ? null : current.result,
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
    [resetOnSubmit, serverFn],
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
    setState({
      pendingCount: 0,
      status: "idle",
      result: initialResult,
      error: null,
    });
  }, [initialResult]);

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
