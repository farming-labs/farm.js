import { createAdapterCaller } from "./adapter-client.js";

import type { FarmStorageCustomDriverConfig } from "@farm.js/core/storage";
import type { Driver } from "unstorage";
import type { ConvexAdapterCaller, ConvexKeyPrefixer, ConvexStorageOptions } from "./types.js";

function createKeyPrefixer(namespace: string | undefined): ConvexKeyPrefixer {
  const prefix = namespace ? `${namespace}:` : "";
  return {
    addPrefix: (key: string) => `${prefix}${key}`,
    removePrefix: (key: string) => key.slice(prefix.length),
  };
}

function createReadMethods(caller: ConvexAdapterCaller, prefixer: ConvexKeyPrefixer) {
  const getItem = (key: string) =>
    caller.query<string | null>("getStorageItem", { key: prefixer.addPrefix(key) });
  return {
    getItem,
    hasItem: async (key: string) => (await getItem(key)) !== null,
    getKeys: async (base: string) => {
      const keys = await caller.query<string[]>("listStorageKeys", {
        prefix: prefixer.addPrefix(base ?? ""),
      });
      return keys.map(prefixer.removePrefix);
    },
  };
}

function createWriteMethods(caller: ConvexAdapterCaller, prefixer: ConvexKeyPrefixer) {
  const clearBatch = (base: string) =>
    caller.mutation<number>("clearStorageItems", { prefix: prefixer.addPrefix(base ?? "") });
  return {
    setItem: async (key: string, value: string) => {
      await caller.mutation("setStorageItem", { key: prefixer.addPrefix(key), value });
    },
    removeItem: async (key: string) => {
      await caller.mutation("removeStorageItem", { key: prefixer.addPrefix(key) });
    },
    clear: async (base: string) => {
      while ((await clearBatch(base)) > 0);
    },
  };
}

export function createConvexStorageDriver(options: ConvexStorageOptions = {}): Driver {
  const caller = createAdapterCaller(options);
  const prefixer = createKeyPrefixer(options.namespace);
  return {
    name: "convex",
    options,
    ...createReadMethods(caller, prefixer),
    ...createWriteMethods(caller, prefixer),
  };
}

export function convexStorage(options: ConvexStorageOptions = {}): FarmStorageCustomDriverConfig {
  return { driver: createConvexStorageDriver(options) };
}
