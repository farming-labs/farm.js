import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import { SECRET_ENVIRONMENT_NAME } from "./secret.js";

import type { ComponentApi } from "./component/_generated/component.js";

function areStringsEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ (rightBytes[index % rightBytes.length] ?? 0);
  }
  return difference === 0;
}

export function requireAdapterSecret(secret: string): void {
  const expected = process.env[SECRET_ENVIRONMENT_NAME];
  if (!expected) {
    throw new Error(`${SECRET_ENVIRONMENT_NAME} is not set on this Convex deployment.`);
  }
  if (!areStringsEqual(secret, expected)) {
    throw new Error(`The ${SECRET_ENVIRONMENT_NAME} sent by Farm does not match this deployment.`);
  }
}

function defineRateLimitFunctions(component: ComponentApi) {
  return {
    incrementRateLimit: mutationGeneric({
      args: { secret: v.string(), key: v.string(), windowMs: v.number() },
      handler: (context, { secret, ...args }) => {
        requireAdapterSecret(secret);
        return context.runMutation(component.rateLimits.increment, args);
      },
    }),
    readRateLimit: queryGeneric({
      args: { secret: v.string(), key: v.string(), now: v.number() },
      handler: (context, { secret, ...args }) => {
        requireAdapterSecret(secret);
        return context.runQuery(component.rateLimits.read, args);
      },
    }),
  };
}

function defineStorageReadFunctions(component: ComponentApi) {
  return {
    getStorageItem: queryGeneric({
      args: { secret: v.string(), key: v.string() },
      handler: (context, { secret, ...args }) => {
        requireAdapterSecret(secret);
        return context.runQuery(component.storage.getItem, args);
      },
    }),
    listStorageKeys: queryGeneric({
      args: { secret: v.string(), prefix: v.string() },
      handler: (context, { secret, ...args }) => {
        requireAdapterSecret(secret);
        return context.runQuery(component.storage.listKeys, args);
      },
    }),
  };
}

function defineStorageWriteFunctions(component: ComponentApi) {
  return {
    setStorageItem: mutationGeneric({
      args: { secret: v.string(), key: v.string(), value: v.string() },
      handler: (context, { secret, ...args }) => {
        requireAdapterSecret(secret);
        return context.runMutation(component.storage.setItem, args);
      },
    }),
    removeStorageItem: mutationGeneric({
      args: { secret: v.string(), key: v.string() },
      handler: (context, { secret, ...args }) => {
        requireAdapterSecret(secret);
        return context.runMutation(component.storage.removeItem, args);
      },
    }),
    clearStorageItems: mutationGeneric({
      args: { secret: v.string(), prefix: v.string() },
      handler: (context, { secret, ...args }) => {
        requireAdapterSecret(secret);
        return context.runMutation(component.storage.clearItems, args);
      },
    }),
  };
}

export function defineFarmFunctions(component: ComponentApi) {
  return {
    ...defineRateLimitFunctions(component),
    ...defineStorageReadFunctions(component),
    ...defineStorageWriteFunctions(component),
  };
}
