// @vitest-environment node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { rolldown } from "rolldown";
import { native, NativeCallError, NativeUnavailableError } from "../native";

declare module "../native" {
  interface FarmNativeModules {
    Device: {
      model(): Promise<string>;
      vibrate(ms: number): Promise<void>;
      pick(kind: string, limit?: number): Promise<string[]>;
    };
  }
}

type Bridge = {
  has(name: string): boolean;
  call(plugin: string, method: string, args: unknown[]): Promise<unknown>;
};

const scope = globalThis as { __farmBridge?: Bridge };
afterEach(() => {
  delete scope.__farmBridge;
});

/** What the shell's farm-bridge.js puts on window: modules it registered, and a call log. */
function installBridge(
  modules: string[],
  answer: (plugin: string, method: string, args: unknown[]) => Promise<unknown>,
) {
  const calls: Array<[string, string, unknown[]]> = [];
  scope.__farmBridge = {
    has: (name) => modules.includes(name),
    call(plugin, method, args) {
      calls.push([plugin, method, args]);
      return answer(plugin, method, args);
    },
  };
  return calls;
}

/** farm-bridge.js rejects with an Error carrying the native code. */
function bridgeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("@farm.js/core/native", () => {
  it("rejects with NativeUnavailableError outside the shell, and available() is false", async () => {
    expect(native.Device.available()).toBe(false);
    const error = await native.Device.model().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NativeUnavailableError);
    expect(error).toMatchObject({
      name: "NativeUnavailableError",
      code: "native_unavailable",
      module: "Device",
      method: "model",
    });
    expect((error as Error).message).toBe(
      "native.Device.model() is not available here. Web screens reach a native module only inside the mobile shell, when mobile.modules.Device.web is true in farm.config.ts. Check native.Device.available() first, and show the web alternative when it is false.",
    );
  });

  it("rejects without calling native when the shell did not register the module", async () => {
    const calls = installBridge([], async () => "never");
    expect(native.Device.available()).toBe(false);
    await expect(native.Device.vibrate(200)).rejects.toBeInstanceOf(NativeUnavailableError);
    expect(calls).toEqual([]);
  });

  it("calls the bridge with positional arguments and resolves with the module's result", async () => {
    const calls = installBridge(["Device"], async (_plugin, method) =>
      method === "model" ? "Pixel 8" : null,
    );
    expect(native.Device.available()).toBe(true);
    await expect(native.Device.model()).resolves.toBe("Pixel 8");
    await expect(native.Device.vibrate(200)).resolves.toBeNull();
    // Optional parameters left out at the end are absent, so the spec check sees no argument.
    await native.Device.pick("photo", undefined);
    expect(calls).toEqual([
      ["Device", "model", []],
      ["Device", "vibrate", [200]],
      ["Device", "pick", ["photo"]],
    ]);
    // The same function every time, so it can be passed around.
    expect(native.Device.model).toBe(native.Device.model);
  });

  it("keeps the shell's codes: native_unavailable as NativeUnavailableError, others as NativeCallError", async () => {
    installBridge(["Device"], async (_plugin, method) => {
      if (method === "model")
        throw bridgeError("native_unavailable", "React Native did not start.");
      if (method === "vibrate") {
        throw bridgeError("invalid_args", "Device.vibrate argument 1 (ms) must be a number.");
      }
      throw new Error("no code");
    });
    const unavailable = await native.Device.model().catch((caught: unknown) => caught);
    expect(unavailable).toBeInstanceOf(NativeUnavailableError);
    expect((unavailable as NativeUnavailableError).cause).toMatchObject({
      message: "React Native did not start.",
    });

    const invalid = await native.Device.vibrate("200" as never).catch((caught: unknown) => caught);
    expect(invalid).toBeInstanceOf(NativeCallError);
    expect(invalid).toMatchObject({
      name: "NativeCallError",
      code: "invalid_args",
      module: "Device",
      method: "vibrate",
      message:
        "native.Device.vibrate() failed (invalid_args): Device.vibrate argument 1 (ms) must be a number.",
    });
    await expect(native.Device.pick("photo")).rejects.toMatchObject({ code: "native_error" });
  });

  it("is not a thenable, so awaiting a module does not call native", async () => {
    const calls = installBridge(["Device"], async () => null);
    expect(await Promise.resolve(native.Device)).toBe(native.Device);
    expect((native as unknown as { then?: unknown }).then).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("costs nothing in a bundle that imports it without using it", async () => {
    const entry = fileURLToPath(new URL("../native.ts", import.meta.url));
    const bundle = await rolldown({
      input: "entry",
      plugins: [
        {
          name: "entry",
          resolveId: (id) => (id === "entry" ? id : undefined),
          load: (id) =>
            id === "entry"
              ? `import { native } from ${JSON.stringify(entry.split(path.sep).join("/"))};\nexport const unused = typeof native === "undefined" ? 0 : 1;\nconsole.log("app");`
              : undefined,
        },
      ],
      treeshake: true,
    });
    const used = await bundle.generate({ format: "esm" });
    expect(used.output[0].code).toContain("createNative");

    const unused = await rolldown({
      input: "entry",
      plugins: [
        {
          name: "entry",
          resolveId: (id) => (id === "entry" ? id : undefined),
          load: (id) =>
            id === "entry"
              ? `import { native } from ${JSON.stringify(entry.split(path.sep).join("/"))};\nconsole.log("app");`
              : undefined,
        },
      ],
      treeshake: true,
    });
    const { output } = await unused.generate({ format: "esm" });
    // Only the app's own code is left; the region comments are rolldown's.
    expect(output[0].code.replace(/^\/\/.*$/gm, "").trim()).toBe('console.log("app");');
  });
});
