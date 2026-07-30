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
  | "/docs/devtools"
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
  | "/docs/internationalization"
  | "/docs/layers"
  | "/docs/layouts"
  | "/docs/markdown"
  | "/docs/middleware"
  | "/docs/migrations"
  | "/docs/migrations/nextjs"
  | "/docs/migrations/nuxt"
  | "/docs/migrations/sveltekit"
  | "/docs/migrations/tanstack"
  | "/docs/observability"
  | "/docs/openapi"
  | "/docs/plugins"
  | "/docs/plugins/create-plugin"
  | "/docs/preview"
  | "/docs/project-structure"
  | "/docs/query"
  | "/docs/reference"
  | "/docs/route-runtime"
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
  | "/docs/devtools"
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
  | "/docs/internationalization"
  | "/docs/layers"
  | "/docs/layouts"
  | "/docs/markdown"
  | "/docs/middleware"
  | "/docs/migrations"
  | "/docs/migrations/nextjs"
  | "/docs/migrations/nuxt"
  | "/docs/migrations/sveltekit"
  | "/docs/migrations/tanstack"
  | "/docs/observability"
  | "/docs/openapi"
  | "/docs/plugins"
  | "/docs/plugins/create-plugin"
  | "/docs/preview"
  | "/docs/project-structure"
  | "/docs/query"
  | "/docs/reference"
  | "/docs/route-runtime"
  | "/docs/routing"
  | "/docs/server-queries"
  | "/docs/server-rendering"
  | "/docs/storage"
  | "/docs/testing";
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
