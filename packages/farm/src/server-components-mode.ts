/**
 * `experimental.serverComponents`: which engine renders server components.
 *
 * - `"rsc"`: React's Flight pipeline (`@farm.js/plugin/rsc` on `@vitejs/plugin-rsc`).
 * - `"islands"`: Farm's own engine (RFC 0003). Reserved; not available yet.
 *
 * `true` means `{ mode: "rsc" }`. Both modes share one authoring contract.
 */
export type FarmServerComponentsMode = "rsc" | "islands";

export interface FarmServerComponentsOptions {
  mode: FarmServerComponentsMode;
}

export type FarmServerComponentsConfig = boolean | FarmServerComponentsOptions;

/** The engine the config asks for, or `undefined` when server components are off. */
export function resolveFarmServerComponentsMode(
  value: unknown,
): FarmServerComponentsMode | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (value === true) return "rsc";
  const mode = typeof value === "object" ? (value as { mode?: unknown }).mode : undefined;
  if (mode === "rsc" || mode === "islands") return mode;
  throw new TypeError(
    'experimental.serverComponents must be true, false, { mode: "rsc" } or { mode: "islands" }.',
  );
}

/** Whether the app picked the engine explicitly (`{ mode }`), rather than with `true`. */
export function isExplicitFarmServerComponentsMode(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

export const FARM_ISLANDS_MODE_UNAVAILABLE =
  '[Farm.js] experimental.serverComponents: { mode: "islands" } is planned (RFC 0003) and not available yet. Use { mode: "rsc" } or true.';
