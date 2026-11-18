import type { WebVitalsOptions, ResolvedWebVitalsOptions } from "./types.js";

export function resolveWebVitalsOptions(options: WebVitalsOptions): ResolvedWebVitalsOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("webVitals options must be an object");
  }

  const known = new Set(["endpoint"]);
  for (const key of Object.keys(options)) {
    if (!known.has(key)) {
      if (key === "onReport") {
        throw new TypeError(
          "webVitals does not accept onReport: callbacks cannot cross into the browser " +
            "through the server plugin — register the collector from the app client entry " +
            "instead (see webVitalsClient() in @farm.js/web-vitals/client)",
        );
      }
      throw new TypeError(`webVitals does not accept option "${key}"`);
    }
  }

  const endpoint = (options as WebVitalsOptions).endpoint;
  if (endpoint !== undefined && (typeof endpoint !== "string" || !endpoint.trim())) {
    throw new TypeError("webVitals endpoint must be a non-empty string");
  }

  return Object.freeze(endpoint === undefined ? {} : { endpoint: endpoint.trim() });
}
