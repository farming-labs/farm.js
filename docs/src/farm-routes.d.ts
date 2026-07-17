/**
 * Auto-generated route types from src/app.
 * Link href is typed automatically via module augmentation. Regenerated on dev start and when routes change.
 * Set suppressLintOnLink: true in farm.config.ts to accept any string on Link href.
 */
export type RoutePath =
  | "/"
  | "/docs"
  | `/docs/${string}`
  | "/docs/after"
  | "/docs/api-client"
  | "/docs/api-routes"
  | "/docs/cache-ppr"
  | "/docs/cli"
  | "/docs/configuration"
  | "/docs/cron"
  | "/docs/deployment"
  | "/docs/docs-engine"
  | "/docs/environment-functions"
  | "/docs/examples"
  | "/docs/getting-started"
  | "/docs/integrations"
  | "/docs/integrations/auth"
  | "/docs/integrations/auth/auth0"
  | "/docs/integrations/auth/authjs"
  | "/docs/integrations/auth/better-auth"
  | "/docs/integrations/auth/clerk"
  | "/docs/integrations/auth/supabase"
  | "/docs/integrations/auth/workos"
  | "/docs/integrations/autumn"
  | "/docs/integrations/cf-agent"
  | "/docs/integrations/custom"
  | "/docs/integrations/email"
  | "/docs/integrations/eve"
  | "/docs/integrations/inngest"
  | "/docs/integrations/jobs"
  | "/docs/integrations/orm-storage"
  | "/docs/integrations/polar"
  | "/docs/integrations/stripe"
  | "/docs/integrations/trigger"
  | "/docs/integrations/ui-registry"
  | "/docs/integrations/unkey"
  | "/docs/layers"
  | "/docs/layouts"
  | "/docs/markdown"
  | "/docs/middleware"
  | "/docs/migrations"
  | "/docs/observability"
  | "/docs/openapi"
  | "/docs/plugins"
  | "/docs/plugins/create-plugin"
  | "/docs/preview"
  | "/docs/project-structure"
  | "/docs/query"
  | "/docs/reference"
  | "/docs/routing"
  | "/docs/server-queries"
  | "/docs/server-rendering"
  | "/docs/storage"
  | "/docs/testing";
export type RoutePattern =
  | "/"
  | "/docs"
  | "/docs/[...docs]"
  | "/docs/after"
  | "/docs/api-client"
  | "/docs/api-routes"
  | "/docs/cache-ppr"
  | "/docs/cli"
  | "/docs/configuration"
  | "/docs/cron"
  | "/docs/deployment"
  | "/docs/docs-engine"
  | "/docs/environment-functions"
  | "/docs/examples"
  | "/docs/getting-started"
  | "/docs/integrations"
  | "/docs/integrations/auth"
  | "/docs/integrations/auth/auth0"
  | "/docs/integrations/auth/authjs"
  | "/docs/integrations/auth/better-auth"
  | "/docs/integrations/auth/clerk"
  | "/docs/integrations/auth/supabase"
  | "/docs/integrations/auth/workos"
  | "/docs/integrations/autumn"
  | "/docs/integrations/cf-agent"
  | "/docs/integrations/custom"
  | "/docs/integrations/email"
  | "/docs/integrations/eve"
  | "/docs/integrations/inngest"
  | "/docs/integrations/jobs"
  | "/docs/integrations/orm-storage"
  | "/docs/integrations/polar"
  | "/docs/integrations/stripe"
  | "/docs/integrations/trigger"
  | "/docs/integrations/ui-registry"
  | "/docs/integrations/unkey"
  | "/docs/layers"
  | "/docs/layouts"
  | "/docs/markdown"
  | "/docs/middleware"
  | "/docs/migrations"
  | "/docs/observability"
  | "/docs/openapi"
  | "/docs/plugins"
  | "/docs/plugins/create-plugin"
  | "/docs/preview"
  | "/docs/project-structure"
  | "/docs/query"
  | "/docs/reference"
  | "/docs/routing"
  | "/docs/server-queries"
  | "/docs/server-rendering"
  | "/docs/storage"
  | "/docs/testing";
declare module "@farmjs/core/client" {
  interface LinkDefaultRoute {
    _: import("./farm-routes").RoutePath;
    pattern: import("./farm-routes").RoutePattern;
  }
}

declare module "@farmjs/core" {
  interface LinkDefaultRoute {
    _: import("./farm-routes").RoutePath;
    pattern: import("./farm-routes").RoutePattern;
  }
  // Ensure root import ("@farmjs/core") uses the same typed Link signature as client entry.
  const Link: typeof import("@farmjs/core/client").Link;
}

// Internal declaration path used by @farmjs/core root type re-exports.
declare module "@farmjs/core/dist/client.js" {
  interface LinkDefaultRoute {
    _: import("./farm-routes").RoutePath;
    pattern: import("./farm-routes").RoutePattern;
  }
}
