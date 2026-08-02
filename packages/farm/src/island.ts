/**
 * Controls when Farm loads and hydrates a server-rendered client boundary.
 *
 * `load` is the compatibility-first default. The deferred strategies keep the
 * server-rendered HTML visible while postponing the boundary's JavaScript.
 */
export type FarmIslandStrategy = "load" | "interaction" | "visible" | "idle";

export const FARM_ISLAND_STRATEGIES = ["load", "interaction", "visible", "idle"] as const;

export function isFarmIslandStrategy(value: unknown): value is FarmIslandStrategy {
  return FARM_ISLAND_STRATEGIES.includes(value as FarmIslandStrategy);
}
