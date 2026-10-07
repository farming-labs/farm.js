/**
 * Server-only image responses for API routes and other server code.
 *
 * This is the same `@vercel/og` runtime that renders `opengraph-image` and
 * `twitter-image` route files, so apps do not need their own dependency and
 * production builds package its wasm and font assets for the deployment target.
 * Farm rejects this entry in browser graphs.
 */
export { ImageResponse } from "@vercel/og";
export type { ImageResponseOptions } from "@vercel/og";
