export type MultipartField = string | number | boolean | bigint | Blob | Date | null | undefined;

export type MultipartValues = Record<string, MultipartField | readonly MultipartField[]>;

/**
 * A real FormData value that retains the submitted value shape for generated
 * API-client inference.
 */
export type TypedFormData<TValues> = FormData & {
  readonly __farmMultipartInput: TValues;
};

export type MultipartSchema<TSchema> = TSchema & {
  readonly __farmMultipartSchema: true;
};

export type FarmStreamResponse<TItem> = Response & {
  readonly __farmStreamItem: TItem;
};

export interface FarmAPIStream<TItem> extends AsyncIterable<TItem> {
  readonly response: Response;
  cancel(reason?: unknown): Promise<void>;
}

type SchemaLike = {
  parse(data: unknown): unknown;
};

/**
 * Mark a body schema as multipart. The handler still receives the schema's
 * parsed object; generated clients require `toFormData(...)` for the request.
 */
export function multipart<TSchema extends SchemaLike>(schema: TSchema): MultipartSchema<TSchema> {
  if (!Object.isExtensible(schema) && !isMultipartSchema(schema)) {
    throw new TypeError("multipart() requires an extensible schema object");
  }

  if (!isMultipartSchema(schema)) {
    Object.defineProperty(schema, "__farmMultipartSchema", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }

  return schema as MultipartSchema<TSchema>;
}

export function isMultipartSchema(value: unknown): value is MultipartSchema<SchemaLike> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __farmMultipartSchema?: unknown }).__farmMultipartSchema === true &&
    typeof (value as SchemaLike).parse === "function"
  );
}

/**
 * Encode a typed object as multipart FormData without converting File or Blob
 * values to JSON or base64.
 */
export function toFormData<TValues extends MultipartValues>(
  values: TValues,
): TypedFormData<TValues> {
  const formData = new FormData();

  for (const [key, value] of Object.entries(values)) {
    if (isUnsafeFormKey(key)) continue;
    if (Array.isArray(value)) {
      for (const entry of value) appendFormValue(formData, key, entry);
      continue;
    }
    appendFormValue(formData, key, value as MultipartField);
  }

  return formData as TypedFormData<TValues>;
}

/**
 * Stream JSON values as newline-delimited JSON. Each source value becomes one
 * independently decodable item instead of buffering the whole response.
 */
export function jsonStream<TItem>(
  source: AsyncIterable<TItem> | Iterable<TItem>,
  init: ResponseInit = {},
): FarmStreamResponse<TItem> {
  const iterator = toAsyncIterator(source);
  const encoder = new TextEncoder();
  let finished = false;

  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (finished) return;

        try {
          const next = await iterator.next();
          if (next.done) {
            finished = true;
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
        } catch (error) {
          finished = true;
          controller.error(error);
        }
      },
      async cancel(reason) {
        finished = true;
        await iterator.return?.(reason);
      },
    },
    {
      // Do not read the next application event until the response consumer
      // requests another chunk.
      highWaterMark: 0,
    },
  );
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/x-ndjson; charset=utf-8");
  }
  headers.set("cache-control", headers.get("cache-control") ?? "no-store");

  return new Response(body, {
    ...init,
    headers,
  }) as FarmStreamResponse<TItem>;
}

export function isJSONStreamResponse(response: { headers?: Pick<Headers, "get"> | null }): boolean {
  const contentType = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
  return contentType.includes("application/x-ndjson") || contentType.includes("application/ndjson");
}

/**
 * Decode a Farm JSON stream lazily. The response body is read only as the
 * consumer advances the async iterator, preserving fetch backpressure.
 */
export function readJSONStream<TItem>(response: Response): FarmAPIStream<TItem> {
  if (!response.body) {
    throw new TypeError("Cannot read a JSON stream response without a body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let claimed = false;

  const iterator: AsyncIterator<TItem> = {
    async next() {
      while (true) {
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd >= 0) {
          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);
          if (!line) continue;
          return { done: false, value: JSON.parse(line) as TItem };
        }

        if (completed) {
          const line = buffer.trim();
          buffer = "";
          if (!line) return { done: true, value: undefined };
          return { done: false, value: JSON.parse(line) as TItem };
        }

        const chunk = await reader.read();
        completed = chunk.done;
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      }
    },
    async return() {
      completed = true;
      buffer = "";
      await reader.cancel();
      return { done: true, value: undefined };
    },
  };

  return {
    response,
    async cancel(reason) {
      completed = true;
      buffer = "";
      await reader.cancel(reason);
    },
    [Symbol.asyncIterator]() {
      if (claimed) {
        throw new TypeError("Farm API streams can only be consumed once");
      }
      claimed = true;
      return iterator;
    },
  };
}

export function isFarmAPIStream(value: unknown): value is FarmAPIStream<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "response" in value &&
    typeof (value as FarmAPIStream<unknown>).cancel === "function" &&
    typeof (value as FarmAPIStream<unknown>)[Symbol.asyncIterator] === "function"
  );
}

function appendFormValue(formData: FormData, key: string, value: MultipartField): void {
  if (value === undefined) return;
  if (value === null) {
    formData.append(key, "");
    return;
  }
  if (value instanceof Blob) {
    formData.append(key, value);
    return;
  }
  if (value instanceof Date) {
    formData.append(key, value.toISOString());
    return;
  }
  formData.append(key, String(value));
}

function isUnsafeFormKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function toAsyncIterator<TItem>(
  source: AsyncIterable<TItem> | Iterable<TItem>,
): AsyncIterator<TItem> {
  if (Symbol.asyncIterator in Object(source)) {
    return (source as AsyncIterable<TItem>)[Symbol.asyncIterator]();
  }

  const iterator = (source as Iterable<TItem>)[Symbol.iterator]();
  return {
    next: async () => iterator.next(),
    return: iterator.return ? async (value?: unknown) => iterator.return!(value) : undefined,
  };
}
