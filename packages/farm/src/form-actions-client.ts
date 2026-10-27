/**
 * The browser side of islands-mode server actions: a client component's import of a `"use server"`
 * module becomes these stubs, so no server code reaches the bundle.
 */
const FARM_FORM_ACTION_HEADER = "x-farm-action";

export async function callFarmFormAction(id: string, args: unknown[]): Promise<unknown> {
  const single = args.length === 1 && args[0] instanceof FormData ? (args[0] as FormData) : null;
  const response = await fetch(location.href, {
    method: "POST",
    headers: single
      ? { [FARM_FORM_ACTION_HEADER]: id }
      : { [FARM_FORM_ACTION_HEADER]: id, "content-type": "text/plain;charset=UTF-8" },
    body: single ?? JSON.stringify(args),
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Server action failed: ${response.status}`);
  const payload = (await response.json()) as { result?: unknown; redirect?: string };
  if (payload.redirect) {
    location.assign(payload.redirect);
    return undefined;
  }
  return payload.result;
}

export function createFarmFormActionStub(id: string) {
  const stub = (...args: unknown[]) => callFarmFormAction(id, args);
  Object.defineProperty(stub, "$$farmActionId", { value: id });
  return stub;
}
