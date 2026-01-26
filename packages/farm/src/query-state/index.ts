/**
 * Farm.js Query State Management
 *
 * Type-safe URL search parameter state management using nuqs
 * Provides useState-like API for managing URL query parameters
 */

// Re-export nuqs client utilities
export {
  useQueryState,
  useQueryStates,
  useQueryState as useSearchParam,
  useQueryStates as useSearchParams,
  parseAsString,
  parseAsInteger,
  parseAsFloat,
  parseAsBoolean,
  parseAsArrayOf,
  parseAsJson,
  parseAsIsoDate,
  parseAsIsoDateTime,
  createParser,
  type Parser,
} from "nuqs";

// Re-export nuqs server utilities
export { createLoader, createSerializer, type SearchParams, type UrlKeys } from "nuqs/server";

// Farm.js specific utilities
export * from "./client";
export * from "./server";
