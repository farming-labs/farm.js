import type { Calculation, CalculationResult } from "./worker";

export function calculateInWorker(input: Calculation, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<CalculationResult>) => {
      cleanup();
      if (data.ok) resolve(data.value);
      else reject(new Error(data.error));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      cleanup();
      reject(new Error(event.message || "Worker could not load"));
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(new Error("Worker returned an unreadable message"));
    };
    try {
      worker.postMessage(input);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
