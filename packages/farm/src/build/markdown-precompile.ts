import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

/**
 * Compiled code of the Markdown pages a build prerenders, keyed by page body, being compiled in a
 * worker thread while the bundles build.
 */
export interface FarmMarkdownPrecompile {
  /** Settles with whatever compiled; a page missing from it compiles when it renders. */
  pages: Promise<Map<string, string>>;
  /** Stops the worker if it is still compiling. */
  dispose(): void;
}

// A CommonJS script, as `eval: true` runs it. It compiles with the runtime's own function, so the
// code is what a render would compile. A page that fails to compile is left out: its render
// compiles it again and fails as it would without this.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
import(workerData.runtime).then(async ({ compileFarmMarkdownPage }) => {
  const pages = [];
  for (const body of workerData.bodies) {
    try {
      pages.push([body, await compileFarmMarkdownPage(body)]);
    } catch {}
  }
  parentPort.postMessage(pages);
});
`;

/**
 * Starts compiling these page bodies off the main thread, with `@farm.js/core`'s built Markdown
 * runtime. Without it (core run from source and not built) nothing is compiled.
 */
export function precompileFarmMarkdownPages(
  bodies: readonly string[],
  coreRoot: string | null,
): FarmMarkdownPrecompile {
  const runtime = coreRoot
    ? path.join(coreRoot, "dist", "internal", "app-markdown-runtime.mjs")
    : null;
  if (bodies.length === 0 || !runtime || !existsSync(runtime)) {
    return { pages: Promise.resolve(new Map()), dispose() {} };
  }
  let worker: Worker | undefined;
  const pages = new Promise<Map<string, string>>((resolve) => {
    const done = (entries: Array<[string, string]> = []) => {
      worker = undefined;
      resolve(new Map(entries));
    };
    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { runtime: pathToFileURL(runtime).href, bodies: [...new Set(bodies)] },
      });
    } catch {
      done();
      return;
    }
    // Precompiling only saves time: any failure leaves the pages to compile when they render.
    worker.once("message", (entries: Array<[string, string]>) => {
      void worker?.terminate();
      done(entries);
    });
    worker.once("error", () => done());
    worker.once("exit", () => done());
  });
  return {
    pages,
    dispose() {
      void worker?.terminate();
    },
  };
}
