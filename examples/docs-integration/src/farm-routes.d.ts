/**
 * Auto-generated route types from src/app.
 * Link href is typed automatically via module augmentation. Regenerated on dev start and when routes change.
 * Set suppressLintOnLink: true in farm.config.ts to accept any string on Link href.
 */
export type RoutePath = "/" | "/docs" | `/docs/${string}`;
declare module "@farm.js/core/client" {
  interface LinkDefaultRoute {
    _: import("./farm-routes").RoutePath;
  }
}

declare module "@farm.js/core" {
  interface LinkDefaultRoute {
    _: import("./farm-routes").RoutePath;
  }
  // Ensure root import ("@farm.js/core") uses the same typed Link signature as client entry.
  const Link: typeof import("@farm.js/core/client").Link;
}

// Internal declaration path used by @farm.js/core root type re-exports.
declare module "@farm.js/core/dist/client.js" {
  interface LinkDefaultRoute {
    _: import("./farm-routes").RoutePath;
  }
}

