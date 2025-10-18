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
  type inferParserType,
} from './parsers';

// Re-export types
export * from './types';
