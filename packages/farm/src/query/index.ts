/**
 * Farm.js Query State Management
 *
 * Type-safe URL search parameter state management
 * Provides useState-like API for managing URL query parameters
 *
 * This module exports shared parsers and types that can be used in both client and server contexts.
 * For client-specific hooks, use 'farm/query/client'
 * For server-specific utilities, use 'farm/query/server'
 */

// Re-export shared parsers that work in both client and server
export {
  asString,
  asInteger,
  asFloat,
  asBoolean,
  asArrayOf,
  asJson,
  asIsoDate,
  asIsoDateTime,
  createParser,
  type Parser,
  type inferParserType,
} from "./parsers";
export { parseRouteParams, loadRouteParams, type RouteParamsInput } from "./params";

// Re-export types
export type {
  PagePropsSafe,
  LayoutPropsSafe,
  QueryStateConfig,
  FarmQueryStateContext,
  QueryStateProvider,
} from "./types";
