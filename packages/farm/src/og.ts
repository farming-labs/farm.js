/**
 * Server-only image responses for API routes and other server code.
 *
 * This is the same `@vercel/og` runtime that renders `opengraph-image` and
 * `twitter-image` route files. `@vercel/og` is an optional peer of
 * `@farm.js/core`: apps that render images install it, and production builds
 * package its wasm and font assets for the deployment target. Farm rejects
 * this entry in browser graphs, and fails the build when `@vercel/og` is not
 * installed.
 */
export { ImageResponse } from "@vercel/og";
export type { ImageResponseOptions } from "@vercel/og";
