"use client";

import {
  createElement,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type FormHTMLAttributes,
} from "react";
import { getAPIRouteRefMetadata, isAPIRouteRef } from "./api/client";
import {
  useMutationLifecycle,
  type AnyMutationTarget,
  type InferMutationData,
  type InferMutationError,
  type InferMutationVariables,
  type MutationStatus,
  type UseMutationOptions,
} from "./mutation-client";

export type FetcherState = "idle" | "submitting";

/** Local form conversion failed before the target was called. */
export class FetcherInputError extends Error {
  readonly name = "FetcherInputError" as const;
  readonly code = "input_error" as const;
  readonly status = 0 as const;
  readonly data = undefined;
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : typeof cause === "string"
          ? cause
          : "Could not prepare form input",
    );
    this.cause = cause;
  }
}

export type FetcherFormDataContext = {
  form: HTMLFormElement | null;
  submitter: HTMLElement | null;
};

export type UseFetcherOptions<TTarget extends AnyMutationTarget> = Omit<
  UseMutationOptions<
    InferMutationVariables<TTarget>,
    InferMutationData<TTarget>,
    InferMutationError<TTarget> | FetcherInputError
  >,
  "request"
> & {
  request?: UseMutationOptions<
    InferMutationVariables<TTarget>,
    InferMutationData<TTarget>,
    InferMutationError<TTarget>
  >["request"];
  /**
   * Convert browser FormData into the target's typed variables.
   *
   * Generated API routes preserve multipart forms and file values as a FormData
   * body; text-only submissions default to a JSON object (or query for GET/HEAD).
   * Server functions receive FormData directly. This mapper overrides defaults.
   */
  mapFormData?: (
    formData: FormData,
    context: FetcherFormDataContext,
  ) => InferMutationVariables<TTarget>;
};

export type FetcherFormProps = Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "onSubmit"> & {
  /**
   * Override the native form fallback. By default server functions remain the
   * action and generated GET/POST API routes use their real URL.
   */
  action?: string | ((formData: FormData) => void | Promise<void>);
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
};

type FetcherInput<TTarget extends AnyMutationTarget> = InferMutationVariables<TTarget> | FormData;

export type FetcherSubmitAsync<TTarget extends AnyMutationTarget> =
  [] extends Parameters<TTarget>
    ? (input?: FetcherInput<TTarget>) => Promise<InferMutationData<TTarget>>
    : (input: FetcherInput<TTarget>) => Promise<InferMutationData<TTarget>>;

export type FetcherSubmit<TTarget extends AnyMutationTarget> =
  [] extends Parameters<TTarget>
    ? (input?: FetcherInput<TTarget>) => void
    : (input: FetcherInput<TTarget>) => void;

export type UseFetcherReturn<TTarget extends AnyMutationTarget> = {
  state: FetcherState;
  status: MutationStatus;
  pending: boolean;
  data: InferMutationData<TTarget> | null;
  error: InferMutationError<TTarget> | FetcherInputError | null;
  variables: InferMutationVariables<TTarget> | undefined;
  formData: FormData | null;
  submit: FetcherSubmit<TTarget>;
  submitAsync: FetcherSubmitAsync<TTarget>;
  Form: ComponentType<FetcherFormProps>;
  reset: () => void;
};

const formDataContexts = new WeakMap<FormData, FetcherFormDataContext>();

/**
 * Run a typed server function or generated API operation without navigating.
 *
 * `fetcher.Form` progressively keeps a server function as the native form
 * action, while hydration intercepts submissions into this fetcher lifecycle.
 */
export function useFetcher<TTarget extends AnyMutationTarget>(
  target: TTarget,
  options: UseFetcherOptions<TTarget> = {},
): UseFetcherReturn<TTarget> {
  const targetRef = useRef(target);
  const optionsRef = useRef(options);
  const submissionIdRef = useRef(0);
  const [formData, setFormData] = useState<FormData | null>(null);
  const { mutation, mutatePreparedAsync } = useMutationLifecycle<
    TTarget,
    InferMutationError<TTarget> | FetcherInputError
  >(target, options);

  targetRef.current = target;
  optionsRef.current = options;

  const submitAsync = useCallback(
    async (input?: FetcherInput<TTarget>) => {
      const submissionId = ++submissionIdRef.current;
      const submittedFormData = isFormData(input) ? input : null;
      setFormData(submittedFormData);

      try {
        return await mutatePreparedAsync(() => {
          try {
            return (
              submittedFormData
                ? mapFetcherFormData(targetRef.current, submittedFormData, optionsRef.current)
                : input
            ) as InferMutationVariables<TTarget>;
          } catch (error) {
            throw new FetcherInputError(error);
          }
        });
      } finally {
        if (submissionId === submissionIdRef.current) {
          setFormData(null);
        }
      }
    },
    [mutatePreparedAsync],
  ) as FetcherSubmitAsync<TTarget>;

  const submit = useCallback(
    (input?: FetcherInput<TTarget>) => {
      void submitAsync(input as never).catch(() => {});
    },
    [submitAsync],
  ) as FetcherSubmit<TTarget>;

  const Form = useMemo(() => {
    const FetcherForm = ({ action, method, encType, onSubmit, ...props }: FetcherFormProps) => {
      const targetValue = targetRef.current;
      const metadata = getAPIRouteRefMetadata(targetValue);
      const nativeAction = action ?? resolveFetcherFormAction(targetValue, metadata);
      const nativeMethod =
        method ??
        (metadata && (metadata.method === "GET" || metadata.method === "POST")
          ? metadata.method.toLowerCase()
          : metadata
            ? "post"
            : undefined);
      const functionAction = typeof nativeAction === "function";

      const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        onSubmit?.(event);
        if (event.defaultPrevented) return;

        event.preventDefault();
        const submitter = getSubmitter(event);
        const nextFormData = createSubmitterFormData(event.currentTarget, submitter);
        formDataContexts.set(nextFormData, {
          form: event.currentTarget,
          submitter,
        });
        void submitAsync(nextFormData as never).catch(() => {});
      };

      return createElement("form", {
        ...props,
        action: nativeAction as FormHTMLAttributes<HTMLFormElement>["action"],
        method: functionAction ? undefined : nativeMethod,
        encType: functionAction ? undefined : encType,
        onSubmit: handleSubmit,
      });
    };

    FetcherForm.displayName = "FetcherForm";
    return FetcherForm;
  }, [submitAsync]);

  const reset = useCallback(() => {
    submissionIdRef.current += 1;
    setFormData(null);
    mutation.reset();
  }, [mutation.reset]);

  return useMemo(
    () => ({
      state: mutation.pending ? "submitting" : "idle",
      status: mutation.status,
      pending: mutation.pending,
      data: mutation.data,
      error: mutation.error,
      variables: mutation.variables,
      formData,
      submit,
      submitAsync,
      Form,
      reset,
    }),
    [
      Form,
      formData,
      mutation.data,
      mutation.error,
      mutation.pending,
      mutation.status,
      mutation.variables,
      reset,
      submit,
      submitAsync,
    ],
  );
}

function mapFetcherFormData<TTarget extends AnyMutationTarget>(
  target: TTarget,
  formData: FormData,
  options: UseFetcherOptions<TTarget>,
): InferMutationVariables<TTarget> | FormData {
  const context = formDataContexts.get(formData) ?? { form: null, submitter: null };
  if (options.mapFormData) {
    return options.mapFormData(formData, context);
  }
  if (!isAPIRouteRef(target)) {
    return formData;
  }

  const method = getAPIRouteRefMetadata(target)?.method;
  const query = method === "GET" || method === "HEAD";
  const encoding = context.submitter?.getAttribute("formenctype") ?? context.form?.enctype;
  if (
    !query &&
    (encoding?.toLowerCase() === "multipart/form-data" ||
      Array.from(formData.values()).some((value) => typeof value !== "string"))
  ) {
    // Keep files and duplicate fields intact without changing the caller's input
    // or bypassing the unsafe-key filtering used by the JSON mapping path.
    const body = new FormData();
    for (const [key, value] of formData) {
      if (!isUnsafeFormKey(key)) body.append(key, value);
    }
    return { body } as InferMutationVariables<TTarget>;
  }

  const values = formDataToObject(formData);
  return (query ? { query: values } : { body: values }) as InferMutationVariables<TTarget>;
}

function resolveFetcherFormAction(
  target: AnyMutationTarget,
  metadata: ReturnType<typeof getAPIRouteRefMetadata>,
): string | AnyMutationTarget | undefined {
  if (!metadata) return isProgressiveFormAction(target) ? target : undefined;
  if (metadata.sameOrigin) return metadata.path;

  return new URL(metadata.path, metadata.baseURL).href;
}

function formDataToObject(
  formData: FormData,
): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const output: Record<string, FormDataEntryValue | FormDataEntryValue[]> = Object.create(null);
  for (const [key, value] of formData.entries()) {
    if (isUnsafeFormKey(key)) continue;
    const current = output[key];
    if (current === undefined) {
      output[key] = value;
    } else if (Array.isArray(current)) {
      current.push(value);
    } else {
      output[key] = [current, value];
    }
  }
  return output;
}

function isUnsafeFormKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function createSubmitterFormData(form: HTMLFormElement, submitter: HTMLElement | null): FormData {
  try {
    return new FormData(form, submitter as HTMLElement | undefined);
  } catch {
    const formData = new FormData(form);
    const candidate = submitter as
      | (HTMLElement & { disabled?: boolean; name?: string; value?: string })
      | null;
    if (candidate && !candidate.disabled && candidate.name) {
      formData.append(candidate.name, candidate.value ?? "");
    }
    return formData;
  }
}

function getSubmitter(event: FormEvent<HTMLFormElement>): HTMLElement | null {
  const nativeEvent = event.nativeEvent as SubmitEvent;
  return nativeEvent.submitter instanceof HTMLElement ? nativeEvent.submitter : null;
}

function isProgressiveFormAction(target: AnyMutationTarget): boolean {
  const candidate = target as AnyMutationTarget & {
    __farmServerFn?: unknown;
    $$FORM_ACTION?: unknown;
    $$typeof?: unknown;
  };
  return (
    candidate.__farmServerFn === true ||
    typeof candidate.$$FORM_ACTION === "function" ||
    candidate.$$typeof === Symbol.for("react.server.reference")
  );
}

function isFormData(value: unknown): value is FormData {
  if (!value || typeof value !== "object") return false;
  return (
    (typeof FormData !== "undefined" && value instanceof FormData) ||
    (Object.prototype.toString.call(value) === "[object FormData]" &&
      typeof (value as { entries?: unknown }).entries === "function")
  );
}
