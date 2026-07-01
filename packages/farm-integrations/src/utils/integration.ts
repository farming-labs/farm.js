import {
  defineIntegration,
  defineIntegrationAPI,
  type FarmIntegrationHandlerContext,
  type FarmIntegrationAPIOperation,
  type FarmIntegrationLogger,
  type FarmIntegrationRouteMethod,
} from "@farmjs/core";
import type { FarmIntegrationAPI } from "@farmjs/core/client";

export interface AuthRouteIntegrationConfig<TInstance> {
  type: string;
  instance: TInstance;
  log?: FarmIntegrationLogger;
  path: string;
  methods: FarmIntegrationRouteMethod[];
  handler: (
    request: Request,
    context: FarmIntegrationHandlerContext,
    instance: TInstance,
  ) => Promise<Response> | Response;
}

export function createAuthRouteIntegration<TInstance>(
  config: AuthRouteIntegrationConfig<TInstance>,
) {
  return defineIntegration({
    category: "auth",
    type: config.type,
    instance: config.instance,
    log: config.log,
    routes: [
      {
        path: config.path,
        methods: config.methods,
        handler(request: Request, context: FarmIntegrationHandlerContext) {
          return config.handler(request, context, config.instance);
        },
      },
    ],
  });
}

export function methodNotAllowed(allow: readonly string[]): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      Allow: allow.join(", "),
    },
  });
}

export interface PathInferredClientOperation<
  TPath extends string = string,
  TOperation extends FarmIntegrationAPIOperation<any, any, any, any> = FarmIntegrationAPIOperation<
    any,
    any,
    any,
    any
  >,
  TLeafName extends string | undefined = undefined,
> {
  path: TPath;
  operation: TOperation;
  leafName?: TLeafName;
}

type ReplaceLeafSegment<
  TPath extends string,
  TLeafName extends string | undefined = undefined,
> = TLeafName extends string
  ? TPath extends `${infer TBase}/${string}`
    ? `${TBase}/${TLeafName}`
    : TLeafName
  : TPath;

type StripClientRoutePrefix<TPath extends string> = TPath extends `/api/${string}/${infer TRest}`
  ? TRest
  : TPath extends `/${string}/${infer TRest}`
    ? TRest
    : TPath extends `/${infer TRest}`
      ? TRest
      : TPath;

type CamelCaseRouteSegment<TSegment extends string> =
  TSegment extends `${infer THead}-${infer TTail}`
    ? `${THead}${Capitalize<CamelCaseRouteSegment<TTail>>}`
    : TSegment;

type NormalizeClientRouteSegmentType<TSegment extends string> =
  TSegment extends `[...${infer TName}]`
    ? TName
    : TSegment extends `[${infer TName}]`
      ? TName
      : TSegment extends `${infer TName}(${string}`
        ? TName
        : CamelCaseRouteSegment<TSegment>;

type RouteNamespaceFromClientPath<
  TPath extends string,
  TOperation extends FarmIntegrationAPIOperation<any, any, any, any>,
> = TPath extends `${infer THead}/${infer TTail}`
  ? {
      [TKey in NormalizeClientRouteSegmentType<THead>]: RouteNamespaceFromClientPath<
        TTail,
        TOperation
      >;
    }
  : {
      [TKey in NormalizeClientRouteSegmentType<TPath>]: {
        [TMethod in Lowercase<TOperation["method"] & string>]: TOperation;
      };
    };

type UnionToIntersection<TUnion> = (
  TUnion extends unknown ? (value: TUnion) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

type ExpandRecursively<TValue> = TValue extends (...args: any[]) => any
  ? TValue
  : TValue extends object
    ? { [TKey in keyof TValue]: ExpandRecursively<TValue[TKey]> }
    : TValue;

type PathEntryToAPI<TEntry extends PathInferredClientOperation<string, any, any>> =
  TEntry extends PathInferredClientOperation<
    infer TPath extends string,
    infer TOperation extends FarmIntegrationAPIOperation<any, any, any, any>,
    infer TLeafName extends string | undefined
  >
    ? RouteNamespaceFromClientPath<
        StripClientRoutePrefix<ReplaceLeafSegment<TPath, TLeafName>>,
        TOperation
      >
    : never;

type PathEntriesToAPI<TEntries extends readonly PathInferredClientOperation<string, any, any>[]> =
  ExpandRecursively<UnionToIntersection<PathEntryToAPI<TEntries[number]>>>;

export type InferPathInferredClientAPI<
  TEntries extends readonly PathInferredClientOperation<string, any, any>[],
> = PathEntriesToAPI<TEntries>;

function normalizeClientRouteSegment(segment: string): string {
  if (!segment) {
    return segment;
  }

  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return segment.slice(4, -1);
  }

  if (segment.startsWith("[") && segment.endsWith("]")) {
    return segment.slice(1, -1);
  }

  const groupIndex = segment.indexOf("(");
  if (groupIndex > 0) {
    segment = segment.slice(0, groupIndex);
  }

  return segment.replace(/-([a-zA-Z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function getClientSegmentsFromPath(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) {
    return ["index"];
  }

  const stripped =
    segments[0] === "api" && segments.length > 2
      ? segments.slice(2)
      : segments.length > 1
        ? segments.slice(1)
        : [segments[segments.length - 1]!];

  return stripped.map(normalizeClientRouteSegment).filter(Boolean);
}

function setClientOperation(
  target: Record<string, unknown>,
  segments: string[],
  operation: FarmIntegrationAPIOperation<any, any, any, any>,
) {
  const [head, ...tail] = segments;
  if (!head) {
    return;
  }

  if (tail.length === 0) {
    const leaf = ((target[head] as Record<string, unknown> | undefined) || {}) as Record<
      string,
      unknown
    >;
    leaf[operation.method.toLowerCase()] = {
      ...operation,
      path: operation.path,
      __pathless: false,
    };
    target[head] = leaf;
    return;
  }

  const branch = ((target[head] as Record<string, unknown> | undefined) || {}) as Record<
    string,
    unknown
  >;
  target[head] = branch;
  setClientOperation(branch, tail, operation);
}

export function createPathInferredClientApi<
  const TEntries extends readonly PathInferredClientOperation<string, any, any>[],
>(...entries: TEntries): InferPathInferredClientAPI<TEntries> {
  const api: Record<string, unknown> = {};

  for (const entry of entries) {
    const segments = getClientSegmentsFromPath(entry.path);
    if (segments.length === 0) {
      continue;
    }

    if (entry.leafName) {
      segments[segments.length - 1] = entry.leafName;
    }

    setClientOperation(api, segments, entry.operation);
  }

  return defineIntegrationAPI(api as FarmIntegrationAPI) as InferPathInferredClientAPI<TEntries>;
}
