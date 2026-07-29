/**
 * @farm.js/plugin - Official plugins for Farm.js framework
 *
 * This package provides official plugins that extend Farm.js functionality.
 *
 * Available plugins:
 * - @farm.js/plugin/rsc - React Server Components support
 * - @farm.js/plugin/middleware - Standalone middleware support
 * - @farm.js/plugin/api - Standalone API routes support
 * - @farm.js/plugin/observability - request/render/build observability lifecycle hooks
 * - @farm.js/plugin/context - example request context exposure plugin
 *
 * @example
 * ```ts
 * // Using RSC (includes middleware and API support)
 * import { defineConfig } from '@farm.js/plugin/rsc'
 *
 * export default defineConfig({
 *   srcDir: 'src',
 *   experimental: {
 *     serverComponents: true,
 *     serverActions: true,
 *   },
 * })
 * ```
 *
 * @example
 * ```ts
 * // Using standalone plugins (without RSC)
 * import { defineConfig } from 'vite'
 * import { farmMiddleware } from '@farm.js/plugin/middleware'
 * import { farmApi } from '@farm.js/plugin/api'
 *
 * export default defineConfig({
 *   plugins: [
 *     farmMiddleware({ srcDir: 'src', debug: true }),
 *     farmApi({ srcDir: 'src', debug: true }),
 *   ],
 * })
 * ```
 */

export const version = "0.1.0-beta.0";

// Note: Import plugins from their respective subpaths:
// - @farm.js/plugin/rsc
// - @farm.js/plugin/middleware
// - @farm.js/plugin/api
// - @farm.js/plugin/observability
// - @farm.js/plugin/context
// This avoids bundling unused code
