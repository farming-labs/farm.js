/**
 * The browser side of islands-mode server actions: a client component's import of a `"use server"`
 * module becomes these stubs, so no server code reaches the bundle, and an action passed as a prop
 * arrives as one.
 *
 * After an action, the page refreshes, as the same form posted without JavaScript would show it:
 * islands keep their state, and a redirect from the action is a client navigation.
 */
import { decodeFarmJson, encodeFarmJson } from "./client/island-codec";

const FARM_FORM_ACTION_HEADER = "x-farm-action";

interface FarmActionRouter {
  refresh?(options?: { scroll?: boolean }): Promise<void>;
  navigate?(href: string, options?: { replace?: boolean }): Promise<void>;
}

function getRouter(): FarmActionRouter | undefined {
  return (window as Window & { __FARM_SPA_ROUTER__?: FarmActionRouter }).__FARM_SPA_ROUTER__;
}

export async function callFarmFormAction(id: string, args: unknown[]): Promise<unknown> {
  const single = args.length === 1 && args[0] instanceof FormData ? (args[0] as FormData) : null;
  const response = await fetch(location.href, {
    method: "POST",
    headers: single
      ? { [FARM_FORM_ACTION_HEADER]: id }
      : { [FARM_FORM_ACTION_HEADER]: id, "content-type": "text/plain;charset=UTF-8" },
    // Arguments and the result keep their types (Date, Map, BigInt, …): see island-codec.ts.
    body: single ?? JSON.stringify(encodeFarmJson(args)),
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Server action failed: ${response.status}`);
  const payload = (await response.json()) as { result?: unknown; redirect?: string };
  const router = getRouter();
  if (payload.redirect) {
    if (router?.navigate) await router.navigate(payload.redirect);
    else location.assign(payload.redirect);
    return undefined;
  }
  // The action may have changed what the page shows. The caller's pending state (a form's
  // `useFormStatus`, `useActionState`) lasts until the page shows it.
  if (router?.refresh) await router.refresh({ scroll: false });
  return decodeFarmJson(payload.result);
}

export function createFarmFormActionStub(id: string) {
  const stub = (...args: unknown[]) => callFarmFormAction(id, args);
  Object.defineProperty(stub, "$$farmActionId", { value: id });
  return stub;
}

const stubs = new Map<string, ReturnType<typeof createFarmFormActionStub>>();

/** The stub for an action passed as a prop: one per action, so props keep their identity. */
export function getFarmFormActionStub(id: string) {
  let stub = stubs.get(id);
  if (!stub) {
    stub = createFarmFormActionStub(id);
    stubs.set(id, stub);
  }
  return stub;
}
