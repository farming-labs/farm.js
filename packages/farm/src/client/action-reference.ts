/**
 * Server actions as props (islands mode, RFC 0003). A registered `"use server"` function passed to
 * a client component travels as `{"$farmAction": id}`; the browser turns it back into a function
 * that calls the action. Kept free of server code: island boundaries import it.
 */
export const FARM_ACTION_REFERENCE = "$farmAction";

const ACTION_IDS_KEY = Symbol.for("farm.form-actions.ids");

type ActionIds = WeakMap<object, string>;

function actionIds(): ActionIds {
  const scope = globalThis as typeof globalThis & Record<symbol, ActionIds | undefined>;
  return (scope[ACTION_IDS_KEY] ??= new WeakMap());
}

/** Records a server action's id, so props that pass the action can name it. Server only. */
export function setFarmActionId(action: object, id: string): void {
  actionIds().set(action, id);
}

/** The id of a registered server action, or undefined for any other value. */
export function getFarmActionId(value: unknown): string | undefined {
  if (typeof value !== "function") return undefined;
  const scope = globalThis as typeof globalThis & Record<symbol, ActionIds | undefined>;
  return scope[ACTION_IDS_KEY]?.get(value);
}
