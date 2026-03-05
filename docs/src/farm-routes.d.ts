/**
 * Auto-generated route types from src/app.
 * Link href is typed automatically via module augmentation. Regenerated on dev start and when routes change.
 */
export type RoutePath = "/" | "/docs" | "/docs/getting-started" | "/docs/layouts" | "/docs/routing";

declare module "@farmjs/core/client" {
  interface LinkDefaultRoute {
    _: RoutePath;
  }
}
