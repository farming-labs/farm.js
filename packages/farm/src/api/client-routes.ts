import { matchAPIRoute, parseDynamicSegment } from "./route-pattern";

export type APIRouteManifest = readonly {
  readonly path: string;
  readonly methods: readonly string[];
}[];
export type BoundRouteParams = Readonly<Record<string, string | readonly string[]>>;

/** A schema-free lookup shared by every immutable scope of one API client. */
export class ClientRouteManifest {
  private readonly routes: Map<string, APIRouteManifest[number]>;
  private readonly candidates = new Map<string, APIRouteManifest[number][]>();
  private readonly nextSegments = new Map<string, Set<string>>();
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
    // The API client owns this schema-free snapshot; app input is copied above
    // and no mutable route table escapes the client factory.
    const addCandidate = (path: string, route: APIRouteManifest[number]) => {
      let candidates = this.candidates.get(path);
      if (!candidates) this.candidates.set(path, (candidates = []));
      candidates.push(route);
    };
    for (const route of this.routes.values()) {
      addCandidate(route.path, route);
      const segments = route.path.split("/");
      let parent = "";
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!;
        if (i > 0 && parseDynamicSegment(segment)) {
          let next = this.nextSegments.get(parent);
          if (!next) this.nextSegments.set(parent, (next = new Set()));
          next.add(segment);
          if (i === segments.length - 1) addCandidate(parent, route);
        }
        parent = i === 0 ? segment : `${parent}/${segment}`;
      }
    }
  }

  bind(path: string, input: unknown): { segment: string; params: BoundRouteParams } {
    const params = readParams(input);
    const normalized = path.replace(/\/$/, "");
    const candidates = new Set(
      [...(this.nextSegments.get(normalized) ?? [])].filter((segment) => {
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
    const candidates = (this.candidates.get(normalized) ?? []).filter((route) => {
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
