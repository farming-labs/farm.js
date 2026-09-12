import { matchAPIRoute, parseDynamicSegment } from "./route-pattern";

export type APIRouteManifest = readonly {
  readonly path: string;
  readonly methods: readonly string[];
}[];
export type BoundRouteParams = Readonly<Record<string, string | readonly string[]>>;

/** A schema-free lookup shared by every immutable scope of one API client. */
export class ClientRouteManifest {
  readonly routes: Map<string, APIRouteManifest[number]>;
  constructor(routes: APIRouteManifest) {
    this.routes = new Map(
      routes.map((route) => [
        route.path.replace(/\/$/, ""),
        {
          path: route.path.replace(/\/$/, ""),
          methods: [...route.methods],
        },
      ]),
    );
  }

  bind(path: string, input: unknown): { segment: string; params: BoundRouteParams } {
    const params = readParams(input);
    const prefix = `${path.replace(/\/$/, "")}/`;
    const candidates = new Set(
      [...this.routes.keys()]
        .filter((route) => route.startsWith(prefix))
        .map((route) => route.slice(prefix.length).split("/")[0])
        .filter((segment) => {
          const dynamic = parseDynamicSegment(segment);
          return (
            dynamic &&
            Object.keys(params).every((key) => key === dynamic.name) &&
            (Object.prototype.hasOwnProperty.call(params, dynamic.name) || dynamic.optional)
          );
        }),
    );
    if (candidates.size !== 1)
      throw new TypeError(
        `Cannot bind route params at ${path}: supply exactly the next dynamic segment's parameter.`,
      );
    const segment = [...candidates][0]!;
    const dynamic = parseDynamicSegment(segment)!;
    encodeParameter(dynamic, params[dynamic.name]);
    return {
      segment,
      params: Object.freeze(
        Object.fromEntries(
          Object.entries(params).map(([key, value]) => [
            key,
            Array.isArray(value) ? Object.freeze([...value]) : value,
          ]),
        ),
      ),
    };
  }

  resolve(
    path: string,
    method: string,
    bound: BoundRouteParams,
    input?: { params?: unknown },
  ): string {
    const normalized = path.replace(/\/$/, "");
    const supplied = readParams(input?.params);
    const candidates = [...this.routes.values()].filter((route) => {
      if (route.path === normalized) return true;
      if (!route.path.startsWith(`${normalized}/`)) return false;
      const tail = route.path.slice(normalized.length + 1);
      return (
        !tail.includes("/") && Boolean(parseDynamicSegment(tail)) && input?.params !== undefined
      );
    });
    const selected = candidates.filter((route) => {
      const unbound = route.path
        .split("/")
        .map(parseDynamicSegment)
        .filter((part) => part && !Object.prototype.hasOwnProperty.call(bound, part.name));
      return (
        Object.keys(supplied).every((key) => unbound.some((part) => part!.name === key)) &&
        unbound.every(
          (part) => part!.optional || Object.prototype.hasOwnProperty.call(supplied, part!.name),
        )
      );
    });
    if (selected.length !== 1)
      throw new TypeError(
        `Cannot resolve ${method} ${normalized}: missing, unexpected, or ambiguous route params.`,
      );
    const route = selected[0]!;
    if (!route.methods.includes(method) && !(method === "HEAD" && route.methods.includes("GET"))) {
      throw new TypeError(`${method} is not registered for ${route.path}.`);
    }
    const params = { ...bound, ...supplied };
    const resolved = route.path
      .split("/")
      .map((segment) => {
        const dynamic = parseDynamicSegment(segment);
        return dynamic ? encodeParameter(dynamic, params[dynamic.name]) : segment;
      })
      .filter(Boolean)
      .join("/");
    const pathname = `/${resolved}`;
    const winner = matchAPIRoute(this.routes, pathname);
    if (winner?.route.path !== route.path) {
      throw new TypeError(
        `Route ${route.path} resolves to ${pathname}, which is shadowed by ${winner?.route.path ?? "another route"}.`,
      );
    }
    return pathname;
  }
}

function readParams(input: unknown): Record<string, string | readonly string[]> {
  if (input === undefined) return {};
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  ) {
    throw new TypeError("Route params must be a plain object.");
  }
  for (const key of Object.keys(input)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new TypeError(`Unsafe route parameter ${key}.`);
  }
  return input as Record<string, string | readonly string[]>;
}

function encodeParameter(
  parameter: { name: string; catchAll: boolean; optional: boolean },
  value: unknown,
): string {
  if (parameter.optional && value === undefined) return "";
  const parts = parameter.catchAll ? value : [value];
  if (!Array.isArray(parts) || (!parts.length && !parameter.optional)) {
    throw new TypeError(
      `Route parameter ${parameter.name} must be ${parameter.catchAll ? "a non-empty array of strings" : "a string"}.`,
    );
  }
  return Array.from(parts, (part) => {
    if (
      typeof part !== "string" ||
      !part ||
      part === "." ||
      part === ".." ||
      Array.from(part).some(
        (character) =>
          character.charCodeAt(0) <= 31 ||
          (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159),
      )
    ) {
      throw new TypeError(`Invalid value for route parameter ${parameter.name}.`);
    }
    return encodeURIComponent(part);
  }).join("/");
}
