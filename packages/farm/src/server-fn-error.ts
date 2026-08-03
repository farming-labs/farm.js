export const FARM_SERVER_FN_FAILURE_SYMBOL = Symbol.for("farm.server-fn.failure");

export type SerializedServerFnFailure = {
  name: "ServerFnFailure";
  message: string;
  code: string;
  status: number;
  data: unknown;
};

export class ServerFnFailure<
  TCode extends string = string,
  TData = unknown,
  TStatus extends number = number,
> extends Error {
  readonly name = "ServerFnFailure" as const;
  readonly code: TCode;
  readonly data: TData;
  readonly status: TStatus;

  constructor(
    code: TCode,
    data: TData,
    options: {
      status: TStatus;
      message: string;
    },
  ) {
    super(options.message);
    this.code = code;
    this.data = data;
    this.status = options.status;

    Object.defineProperty(this, FARM_SERVER_FN_FAILURE_SYMBOL, {
      value: true,
      enumerable: false,
    });
  }
}

export class ServerActionError extends Error {
  readonly name = "ServerActionError" as const;

  constructor(message = "Server function failed") {
    super(message);
  }
}

export function isServerFnFailure(value: unknown): value is ServerFnFailure {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<ServerFnFailure> & {
    [FARM_SERVER_FN_FAILURE_SYMBOL]?: unknown;
  };
  return (
    candidate[FARM_SERVER_FN_FAILURE_SYMBOL] === true &&
    candidate.name === "ServerFnFailure" &&
    typeof candidate.code === "string" &&
    Number.isInteger(candidate.status) &&
    (candidate.status ?? 0) >= 400 &&
    (candidate.status ?? 0) <= 599
  );
}

export function serializeServerFnFailure(value: unknown): SerializedServerFnFailure | null {
  if (!isServerFnFailure(value)) return null;

  return {
    name: "ServerFnFailure",
    message: value.message,
    code: value.code,
    status: value.status,
    data: value.data,
  };
}

export function createServerFnTransportError(value: unknown): ServerFnFailure | ServerActionError {
  if (isSerializedServerFnFailure(value)) {
    return new ServerFnFailure(value.code, value.data, {
      status: value.status,
      message: value.message,
    });
  }

  const message =
    value && typeof value === "object" && "message" in value && typeof value.message === "string"
      ? value.message
      : "Server function failed";
  return new ServerActionError(message);
}

function isSerializedServerFnFailure(value: unknown): value is SerializedServerFnFailure {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<SerializedServerFnFailure>;
  return (
    candidate.name === "ServerFnFailure" &&
    typeof candidate.message === "string" &&
    typeof candidate.code === "string" &&
    Number.isInteger(candidate.status) &&
    (candidate.status ?? 0) >= 400 &&
    (candidate.status ?? 0) <= 599 &&
    "data" in candidate
  );
}
