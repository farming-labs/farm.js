import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import { describe, expect, it } from "vitest";
import { createFarmDeferredMiddleware } from "../dev/deferred-setup";

const req = {} as IncomingMessage;
const res = {} as ServerResponse;

/** Runs `handle` for one request and resolves with what it passed to the outer `next`. */
function run(handle: Connect.NextHandleFunction): Promise<{ error?: unknown }> {
  return new Promise((resolve) => handle(req, res, (error?: unknown) => resolve({ error })));
}

describe("createFarmDeferredMiddleware", () => {
  it("holds a request until setup is ready, then runs the stack in order", async () => {
    const ready = Promise.withResolvers<void>();
    const events: string[] = [];
    const gate = createFarmDeferredMiddleware(() => ready.promise);
    gate.target.use((_req, _res, next) => {
      events.push("first");
      next();
    });
    const result = run(gate.handle);
    gate.target.use((_req, _res, next) => {
      events.push("second");
      next();
    });
    await Promise.resolve();
    expect(events).toEqual([]);

    ready.resolve();
    expect(await result).toEqual({ error: undefined });
    expect(events).toEqual(["first", "second"]);
    // The setup reads back the handler it just registered, as from Vite's own stack.
    expect(gate.target.stack.map(({ handle }) => typeof handle)).toEqual(["function", "function"]);
  });

  it("stops at a handler that answers and passes errors to the outer stack", async () => {
    const gate = createFarmDeferredMiddleware(() => undefined);
    const answered: string[] = [];
    gate.target.use((_req, _res) => {
      answered.push("answered");
    });
    gate.target.use(() => {
      answered.push("never");
    });
    gate.handle(req, res, () => answered.push("outer"));
    expect(answered).toEqual(["answered"]);

    const failure = new Error("handler failed");
    const failing = createFarmDeferredMiddleware(() => undefined);
    failing.target.use((_req, _res, next) => next(failure));
    failing.target.use(() => answered.push("after failure"));
    expect(await run(failing.handle)).toEqual({ error: failure });

    const throwing = createFarmDeferredMiddleware(() => undefined);
    throwing.target.use(() => {
      throw failure;
    });
    expect(await run(throwing.handle)).toEqual({ error: failure });
    expect(answered).toEqual(["answered"]);
  });

  it("gives a waiting request the setup's failure", async () => {
    const failure = new Error("setup failed");
    const gate = createFarmDeferredMiddleware(() => Promise.reject(failure));
    gate.target.use(() => {
      throw new Error("unreachable");
    });
    expect(await run(gate.handle)).toEqual({ error: failure });
  });
});
