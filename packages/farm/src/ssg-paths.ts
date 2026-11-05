/**
 * Static path materialization for SSG routes: `generateStaticParams()` values to URL paths.
 * Free of Node APIs, so production runtimes can import it as well as the build.
 */

import type { StaticPathParams, StaticPathPrimitive } from "./types";

const OPTIONAL_CATCH_ALL_SEGMENT = /^\[\[\.\.\.([^\]]+)\]\]$/;
const REQUIRED_CATCH_ALL_SEGMENT = /^\[\.\.\.([^\]]+)\]$/;
const REQUIRED_DYNAMIC_SEGMENT = /^\[([^\]]+)\]$/;

export function materializeSSGRoutePath(routePattern: string, params: StaticPathParams): string {
  const outputSegments: string[] = [];

  for (const segment of routePattern.split("/")) {
    if (!segment) {
      continue;
    }

    const optionalCatchAll = segment.match(OPTIONAL_CATCH_ALL_SEGMENT);
    if (optionalCatchAll) {
      const parameterName = optionalCatchAll[1]!;
      const value = params[parameterName];
      const values = readCatchAllSegments(value, {
        optional: true,
        parameterName,
        routePattern,
      });
      outputSegments.push(...values.map(encodePathSegment));
      continue;
    }

    const requiredCatchAll = segment.match(REQUIRED_CATCH_ALL_SEGMENT);
    if (requiredCatchAll) {
      const parameterName = requiredCatchAll[1]!;
      const value = params[parameterName];
      const values = readCatchAllSegments(value, {
        optional: false,
        parameterName,
        routePattern,
      });
      outputSegments.push(...values.map(encodePathSegment));
      continue;
    }

    const requiredDynamic = segment.match(REQUIRED_DYNAMIC_SEGMENT);
    if (requiredDynamic) {
      const parameterName = requiredDynamic[1]!;
      const value = params[parameterName];
      if (isStaticPathArray(value)) {
        throw new Error(
          `Cannot materialize SSG route "${routePattern}": parameter "${parameterName}" ` +
            "must be a scalar value; arrays are only supported for catch-all segments.",
        );
      }
      if (isMissingPathValue(value)) {
        throw missingRequiredParameterError(routePattern, parameterName);
      }
      outputSegments.push(encodePathSegment(value));
      continue;
    }

    outputSegments.push(segment);
  }

  return outputSegments.length > 0 ? `/${outputSegments.join("/")}` : "/";
}

function readCatchAllSegments(
  value: StaticPathParams[string] | undefined,
  options: {
    optional: boolean;
    parameterName: string;
    routePattern: string;
  },
): StaticPathPrimitive[] {
  if (isMissingPathValue(value) || (isStaticPathArray(value) && value.length === 0)) {
    if (options.optional) {
      return [];
    }
    throw missingRequiredParameterError(options.routePattern, options.parameterName);
  }

  const segments = isStaticPathArray(value) ? [...value] : [value as StaticPathPrimitive];
  if (segments.some(isMissingPathValue)) {
    throw new Error(
      `Cannot materialize SSG route "${options.routePattern}": catch-all parameter ` +
        `"${options.parameterName}" contains an empty path segment.`,
    );
  }

  return segments;
}

export function getOptionalCatchAllParameterNames(routePattern: string): ReadonlySet<string> {
  return new Set(
    routePattern
      .split("/")
      .map((segment) => segment.match(OPTIONAL_CATCH_ALL_SEGMENT)?.[1])
      .filter((name): name is string => Boolean(name)),
  );
}

export function normalizeStaticPathParams(
  params: StaticPathParams,
  optionalCatchAllParams: ReadonlySet<string>,
): Record<string, string> {
  const entries = Object.entries(params).map(([key, value]): [string, string] => {
    const emptyOptionalCatchAll =
      optionalCatchAllParams.has(key) &&
      (isMissingPathValue(value) || (isStaticPathArray(value) && value.length === 0));
    return [
      key,
      emptyOptionalCatchAll
        ? ""
        : isStaticPathArray(value)
          ? value.map(String).join("/")
          : String(value),
    ];
  });

  for (const name of optionalCatchAllParams) {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      entries.push([name, ""]);
    }
  }

  return Object.fromEntries(entries);
}

function isMissingPathValue(value: unknown): value is "" | null | undefined {
  return value === "" || value === null || typeof value === "undefined";
}

function isStaticPathArray(
  value: StaticPathParams[string] | undefined,
): value is readonly StaticPathPrimitive[] {
  return Array.isArray(value);
}

function missingRequiredParameterError(routePattern: string, parameterName: string): Error {
  return new Error(
    `Cannot materialize SSG route "${routePattern}": required parameter ` +
      `"${parameterName}" is missing or empty.`,
  );
}

function encodePathSegment(value: StaticPathPrimitive): string {
  const encoded = encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  // Dot-only URL segments are normalized as navigation by URL parsers and
  // filesystem joins. Pre-rendering them could therefore escape the intended
  // route directory or overwrite a parent artifact. They cannot faithfully be
  // represented as a static URL segment, so keep the route server-rendered.
  if (encoded === "." || encoded === "..") {
    throw new Error(
      `Cannot materialize SSG path segment "${encoded}": dot-only segments are unsafe to prerender.`,
    );
  }

  return encoded;
}
