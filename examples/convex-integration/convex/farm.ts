import { defineFarmFunctions } from "@farm.js/convex/functions";
import { components } from "./_generated/api";

export const {
  incrementRateLimit,
  readRateLimit,
  getStorageItem,
  listStorageKeys,
  setStorageItem,
  removeStorageItem,
  clearStorageItems,
} = defineFarmFunctions(components.farm);
