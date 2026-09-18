// @vitest-environment node

import { Writable } from "node:stream";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { createElement, renderToPipeableStream } from "../server";

// Build a tree that renders a synchronous shell, then async-resolves a child
// whose render throws. Because the child's setup awaits a tick, the shell has
// already been flushed (onShellReady fired + the consumer has piped) by the
// time the throw runs, so the rejection propagates to renderToNodeStream's
// top-level catch as a *mid-stream* error — the path the worker-crash bug hit.
// The child is intentionally NOT wrapped in <Suspense>; a Suspense boundary
// would capture the throw and never reach the stream's top-level error path.
function createMidStreamBoomApp(message = "vue midstream boom") {
  let boomed = false;
  const LateBoom = defineComponent({
    name: "LateBoom",
    async setup() {
      await new Promise((resolve) => setTimeout(resolve, 10));
      boomed = true;
    },
    render() {
      if (boomed) throw new Error(message);
      return h("span", "loading");
    },
  });
  return defineComponent({
    name: "MidStreamShell",
    setup: () => () => h("div", [h("p", "shell content"), h(LateBoom)]),
  });
}

interface ConsumerResult {
  settledBy: "finish" | "timeout" | "shellError";
  finalCalled: boolean;
  finalCallCount: number;
  errorEvents: string[];
  onErrorCalled: boolean;
  onShellReadyCalled: boolean;
  onShellErrorCalled: boolean;
  body: string;
  uncaught: Error | null;
}

interface ConsumerOptions {
  // Whether the destination attaches an 'error' listener. The core streaming
  // consumer (renderPageStream) does NOT — that is the posture the bug crashes.
  // The with-listener variant isolates the "_final never runs" half of the bug
  // deterministically (no uncaughtException leaves the test process).
  attachErrorListener: boolean;
  // Whether to install a temporary uncaughtException trap to detect the
  // worker-crash half of the bug in the no-listener (faithful) variant.
  trapUncaught: boolean;
  timeoutMs?: number;
}

function consume(
  element: unknown,
  { attachErrorListener, trapUncaught, timeoutMs = 2000 }: ConsumerOptions,
): Promise<ConsumerResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let finalCalled = false;
    let finalCallCount = 0;
    const errorEvents: string[] = [];
    let onErrorCalled = false;
    let onShellReadyCalled = false;
    let onShellErrorCalled = false;
    let uncaught: Error | null = null;

    // Mirror core's renderPageStream consumer: a Writable with only write/final
    // and (optionally) no 'error' listener — the exact shape the bug targets.
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
      final(callback) {
        finalCalled = true;
        finalCallCount += 1;
        callback();
      },
    });

    if (attachErrorListener) {
      destination.on("error", (err) => {
        errorEvents.push(err instanceof Error ? err.message : String(err));
      });
    }

    const uncaughtHandler = trapUncaught
      ? (err: Error) => {
          uncaught = err;
        }
      : null;
    if (uncaughtHandler) process.prependOnceListener("uncaughtException", uncaughtHandler);

    const cleanup = () => {
      if (uncaughtHandler) process.removeListener("uncaughtException", uncaughtHandler);
      clearTimeout(timer);
    };

    const snapshot = (by: ConsumerResult["settledBy"]): ConsumerResult => ({
      settledBy: by,
      finalCalled,
      finalCallCount,
      errorEvents: [...errorEvents],
      onErrorCalled,
      onShellReadyCalled,
      onShellErrorCalled,
      body: Buffer.concat(chunks).toString("utf8"),
      uncaught,
    });

    destination.once("finish", () => {
      cleanup();
      resolve(snapshot("finish"));
    });

    const timer = setTimeout(() => {
      cleanup();
      resolve(snapshot("timeout"));
    }, timeoutMs);

    const stream = renderToPipeableStream(element, {
      onShellReady() {
        onShellReadyCalled = true;
        stream.pipe(destination);
      },
      onShellError() {
        onShellErrorCalled = true;
        cleanup();
        resolve(snapshot("shellError"));
      },
      onError() {
        onErrorCalled = true;
      },
    });
  });
}

describe("renderToPipeableStream mid-stream errors", () => {
  it("settles the consumer's _final instead of hanging or crashing the worker", async () => {
    // Faithful posture: no 'error' listener (mirrors renderPageStream) and a
    // temporary uncaughtException trap to detect the worker-crash regression.
    // Previously destination.destroy(error) re-emitted via pipe()'s prepended
    // destination onerror -> uncaughtException (worker exit) and skipped _final
    // (hang). Ending the destination drives _final -> res.end()/resolve().
    const result = await consume(createElement(createMidStreamBoomApp(), null), {
      attachErrorListener: false,
      trapUncaught: true,
    });

    expect(result.settledBy).toBe("finish");
    expect(result.finalCalled).toBe(true);
    expect(result.finalCallCount).toBe(1);
    expect(result.uncaught).toBeNull();
    expect(result.onErrorCalled).toBe(true);
    expect(result.onShellReadyCalled).toBe(true);
    expect(result.onShellErrorCalled).toBe(false);
    // The already-flushed shell is preserved (truncated body), matching the
    // React/Solid mid-stream-error behavior the consumer was written against.
    expect(result.body).toContain("<div><p>shell content</p>");
  });

  it("does not re-emit the error onto the destination when it has an 'error' listener", async () => {
    // With-listener variant: a destroy(error) would re-emit 'error' here and
    // still skip _final. Ending the destination neither emits 'error' nor
    // skips _final, so both the error-event list and the settle source stay
    // clean.
    const result = await consume(createElement(createMidStreamBoomApp(), null), {
      attachErrorListener: true,
      trapUncaught: true,
    });

    expect(result.settledBy).toBe("finish");
    expect(result.finalCalled).toBe(true);
    expect(result.finalCallCount).toBe(1);
    expect(result.errorEvents).toEqual([]);
    expect(result.uncaught).toBeNull();
    expect(result.onErrorCalled).toBe(true);
    expect(result.onShellReadyCalled).toBe(true);
    expect(result.onShellErrorCalled).toBe(false);
    expect(result.body).toContain("<div><p>shell content</p>");
  });

  it("still reports a pre-shell error via onShellError without touching the destination", async () => {
    // A synchronous throw during the first render pass happens before any
    // output is pushed, so onShellReady never fires, destination stays
    // undefined, and abortDestination returns early. This guards the shell
    // error path against the regression that motivated d7756ad4 (#1067).
    const Boom = defineComponent({
      name: "ShellBoom",
      setup: () => () => {
        throw new Error("vue shell boom");
      },
    });

    const result = await consume(createElement(Boom, null), {
      attachErrorListener: true,
      trapUncaught: true,
    });

    expect(result.settledBy).toBe("shellError");
    expect(result.onShellErrorCalled).toBe(true);
    expect(result.onShellReadyCalled).toBe(false);
    expect(result.finalCalled).toBe(false);
    expect(result.errorEvents).toEqual([]);
    expect(result.uncaught).toBeNull();
  });

  it("still completes the happy path with the full rendered body", async () => {
    const result = await consume(createElement("p", null, "Streamed from Vue"), {
      attachErrorListener: true,
      trapUncaught: false,
    });

    expect(result.settledBy).toBe("finish");
    expect(result.finalCalled).toBe(true);
    expect(result.finalCallCount).toBe(1);
    expect(result.onErrorCalled).toBe(false);
    expect(result.onShellErrorCalled).toBe(false);
    expect(result.onShellReadyCalled).toBe(true);
    expect(result.body).toContain("<p>Streamed from Vue</p>");
    expect(result.errorEvents).toEqual([]);
  });
});
