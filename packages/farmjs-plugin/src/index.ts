/**
 * @farmjs/plugin - Official plugins for Farm.js framework
 *
 * This package provides official plugins that extend Farm.js functionality.
 *
 * Available plugins:
 * - @farmjs/plugin/rsc - React Server Components support
 * - @farmjs/plugin/middleware - Standalone middleware support
 * - @farmjs/plugin/api - Standalone API routes support
 * - @farmjs/plugin/observability - request/render/build observability lifecycle hooks
 * - @farmjs/plugin/context - example request context exposure plugin
 *
 * @example
 * ```ts
 * // Using RSC (includes middleware and API support)
 * import { defineConfig } from '@farmjs/plugin/rsc'
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
 * import { farmMiddleware } from '@farmjs/plugin/middleware'
 * import { farmApi } from '@farmjs/plugin/api'
 *
 * export default defineConfig({
 *   plugins: [
 *     farmMiddleware({ srcDir: 'src', debug: true }),
 *     farmApi({ srcDir: 'src', debug: true }),
 *   ],
 * })
 * ```
 */

export const version = "0.0.1";

// Note: Import plugins from their respective subpaths:
// - @farmjs/plugin/rsc
// - @farmjs/plugin/middleware
// - @farmjs/plugin/api
// - @farmjs/plugin/observability
// - @farmjs/plugin/context
// This avoids bundling unused code
