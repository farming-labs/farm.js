export interface Calculation {
  left: number;
  right: number;
  operation: "add" | "divide";
}

export type CalculationResult = { ok: true; value: number } | { ok: false; error: string };

self.onmessage = async ({ data }: MessageEvent<Calculation>) => {
  let result: CalculationResult;
  try {
    // Register the listener before awaiting Wasm initialization so the first
    // message cannot arrive while the module is still loading.
    const { add, divide } = await import("./wasm/math");
    const value =
      data.operation === "add" ? add(data.left, data.right) : divide(data.left, data.right);
    result = { ok: true, value };
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(result);
};
