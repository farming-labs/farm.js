/**
 * Auto-generated route types from src/app.
 * Link href is typed automatically via module augmentation. Regenerated on dev start and when routes change.
 * Set suppressLintOnLink: true in farm.config.ts to accept any string on Link href.
 */
export type RoutePath = "/" | "/about" | "/api-demo" | "/api-demo-client" | "/boundaries/error" | "/boundaries/loading" | "/boundaries/suspense" | "/contact" | "/farm-query-client-demo" | "/farm-query-demo" | "/prefetch-e2e" | "/query-demo" | `/users/${string}`;
declare module "@farmjs/core/client" {
  interface LinkDefaultRoute {
    _: import("./farm-routes").RoutePath;
  }
}

declare module "@farmjs/core" {
  interface LinkDefaultRoute {
    _: import("./farm-routes").RoutePath;
  }
  // Ensure root import ("@farmjs/core") uses the same typed Link signature as client entry.
  const Link: typeof import("@farmjs/core/client").Link;
}

// Internal declaration path used by @farmjs/core root type re-exports.
declare module "@farmjs/core/dist/client.js" {
  interface LinkDefaultRoute {
    _: import("./farm-routes").RoutePath;
  }
}

