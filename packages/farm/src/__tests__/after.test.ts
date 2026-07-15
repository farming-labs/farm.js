import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { after, _runWithAfterNodeResponse, _runWithAfterRequest } from "../after";

describe("after", () => {
  it("rejects calls outside a server request", () => {
    expect(() => after(() => {})).toThrow(
      "after() can only be used while Farm is handling a server request.",
    );
    expect(() => after(null as never)).toThrow("after() expects a callback function.");
  });

  it("waits until a Web Response body has been consumed", async () => {
    let didRun = false;
    let resolveRan!: () => void;
    const ran = new Promise<void>((resolve) => {
      resolveRan = resolve;
    });

    const response = await _runWithAfterRequest(new Request("https://farm.local/products"), () => {
      after(() => {
        didRun = true;
        resolveRan();
      });
      return new Response("products");
    });

    expect(didRun).toBe(false);
    await expect(response.text()).resolves.toBe("products");
    await ran;
    expect(didRun).toBe(true);
  });

  it("runs callbacks in order, supports nesting, and isolates errors", async () => {
    const events: string[] = [];
    const callbackError = new Error("analytics unavailable");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await _runWithAfterRequest(new Request("https://farm.local/checkout"), () => {
      after(async () => {
        events.push("first:start");
        await Promise.resolve();
        events.push("first:end");
        after(() => {
          events.push("nested");
        });
      });
      after(() => {
        events.push("failed");
        throw callbackError;
      });
      after(() => {
        events.push("last");
      });
      return new Response("ok");
    });

    await response.text();
    await vi.waitFor(() => expect(events).toContain("nested"));

    expect(events).toEqual(["first:start", "first:end", "failed", "last", "nested"]);
    expect(errorSpy).toHaveBeenCalledWith("[Farm.js] after() callback failed:", callbackError);
    errorSpy.mockRestore();
  });

  it("preserves request-local context from the registration site", async () => {
    const requestScope = new AsyncLocalStorage<string>();
    let observed: string | undefined;

    const response = await _runWithAfterRequest(new Request("https://farm.local/account"), () => {
      requestScope.run("account-42", () => {
        after(() => {
          observed = requestScope.getStore();
        });
      });
      return new Response("account");
    });

    await response.text();
    await vi.waitFor(() => expect(observed).toBe("account-42"));
  });

  it("uses adapter completion and waitUntil hooks when provided", async () => {
    let finishResponse!: () => void;
    let lifetime!: Promise<void>;
    let didRun = false;
    const originalResponse = new Response("accepted", { status: 202 });

    const response = await _runWithAfterRequest(
      new Request("https://farm.local/events", { method: "POST" }),
      () => {
        after(() => {
          didRun = true;
        });
        return originalResponse;
      },
      {
        onResponseFinished(callback) {
          finishResponse = callback;
        },
        waitUntil(promise) {
          lifetime = promise;
        },
      },
    );

    expect(response).toBe(originalResponse);
    await response.text();
    expect(didRun).toBe(false);

    finishResponse();
    await lifetime;
    expect(didRun).toBe(true);
  });

  it("uses Node finish and close events as the response boundary", async () => {
    class MockResponse extends EventEmitter {
      writableEnded = false;
    }

    const response = new MockResponse() as unknown as ServerResponse;
    let didRun = false;
    let lifetime!: Promise<void>;

    await _runWithAfterNodeResponse(
      response,
      () => {
        after(() => {
          didRun = true;
        });
      },
      {
        waitUntil(promise) {
          lifetime = promise;
        },
      },
    );

    expect(didRun).toBe(false);
    response.emit("finish");
    await lifetime;
    expect(didRun).toBe(true);
  });
});
