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

/**
 * How a captured interaction is reproduced once its island has hydrated.
 *
 * `click` and `submit` are held: the original event is prevented so the island
 * can hydrate, then reproduced against the same target. Activation-only
 * interactions carry no kind. They start hydration early and let native
 * behavior proceed untouched, which is what a focus or a keystroke needs.
 */
export type FarmIslandReplayKind = "click" | "submit";

/**
 * Events that can activate a deferred island before its chunk has loaded.
 *
 * The inline pre-hydration script and the island runtime must listen to the
 * same set. An event only one of them knows about is either swallowed with no
 * hydration to follow, or never captured at all.
 */
export const FARM_ISLAND_ACTIVATION_EVENTS = ["click", "submit", "pointerdown", "focusin"] as const;

/** Activation events whose interaction is held and replayed after hydration. */
export const FARM_ISLAND_REPLAYED_EVENTS = ["click", "submit"] as const;

/** Elements whose activation is held and replayed rather than merely observed. */
export const FARM_ISLAND_REPLAYABLE_SELECTOR =
  'button,[role="button"],input[type="button"],input[type="submit"],input[type="reset"]';
