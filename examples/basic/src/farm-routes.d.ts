/**
 * Auto-generated route types from src/app.
 * Link href is typed automatically via module augmentation. Regenerated on dev start and when routes change.
 * Set suppressLintOnLink: true in farm.config.ts to accept any string on Link href.
 */
export type RoutePath = "/" | "/about" | "/api-demo" | "/api-demo-client" | "/api-demo-client-advanced" | "/boundaries/error" | "/boundaries/loading" | "/boundaries/suspense" | "/contact" | "/docs" | `/docs/${string}` | "/docs/getting-started" | "/docs/reference" | "/farm-query-client-demo" | "/farm-query-demo" | "/feature-lab" | "/feature-lab/integrations" | "/feature-lab/layer" | "/feature-lab/login" | `/feature-lab/metadata/${string}` | `/feature-lab/products/${string}` | "/feature-lab/static-metadata" | `/feature-lab/static/${string}` | "/markdown" | "/optional-catchall" | `/optional-catchall/${string}` | "/ppr-demo" | "/prefetch-e2e" | "/query-demo" | "/storage-demo" | "/store-e2e" | `/users/${string}`;
export type RoutePattern = "/" | "/about" | "/api-demo" | "/api-demo-client" | "/api-demo-client-advanced" | "/boundaries/error" | "/boundaries/loading" | "/boundaries/suspense" | "/contact" | "/docs" | "/docs/[...docs]" | "/docs/getting-started" | "/docs/reference" | "/farm-query-client-demo" | "/farm-query-demo" | "/feature-lab" | "/feature-lab/integrations" | "/feature-lab/layer" | "/feature-lab/login" | "/feature-lab/metadata/[id]" | "/feature-lab/products/[id]" | "/feature-lab/static-metadata" | "/feature-lab/static/[slug]" | "/markdown" | "/optional-catchall/[[...slug]]" | "/ppr-demo" | "/prefetch-e2e" | "/query-demo" | "/storage-demo" | "/store-e2e" | "/users/[id]";
declare module "@farm.js/core/client" {
  interface LinkDefaultRoute {
    _: import("./farm-routes").RoutePath;
    pattern: import("./farm-routes").RoutePattern;
  }
}

declare module "@farm.js/core" {
  interface LinkDefaultRoute {
    _: import("./farm-routes").RoutePath;
    pattern: import("./farm-routes").RoutePattern;
  }
  // Ensure root import ("@farm.js/core") uses the same typed Link signature as client entry.
  const Link: typeof import("@farm.js/core/client").Link;
}

// Internal declaration path used by @farm.js/core root type re-exports.
declare module "@farm.js/core/dist/client.js" {
  interface LinkDefaultRoute {
    _: import("./farm-routes").RoutePath;
    pattern: import("./farm-routes").RoutePattern;
  }
}

