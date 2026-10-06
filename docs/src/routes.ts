import { handleUIRegistryRequest, UI_REGISTRY_ROUTE_PATTERN } from "@farm.js/cli/ui-registry";
import { defineRoutes } from "@farm.js/core";
import { createSiteSitemapResponse, SITE_SITEMAP_PATH } from "./lib/site-sitemap";

// farmjs.dev serves the shadcn registry that `farm add integration --ui` writes
// into every generated `components.json` as `https://farmjs.dev/r/{name}.json`.
//
// This is a programmatic route rather than a file route because the advertised
// url has no `/api` prefix, and file routes are only discovered under
// `src/app/api`. The handler and the advertised url template both come from
// `@farm.js/cli/ui-registry`, so the path served here cannot drift from the path
// the CLI writes.
//
// The site sitemap is programmatic for the same reason: a root sitemap.ts serves
// `/sitemap.xml`, which the docs engine answers with the docs pages, and a nested
// one only covers URLs under its own directory.
export default defineRoutes(({ api }) => [
  api(UI_REGISTRY_ROUTE_PATTERN, {
    GET: (request: Request) => handleUIRegistryRequest(request),
  }),
  api(SITE_SITEMAP_PATH, {
    GET: () => createSiteSitemapResponse(),
  }),
]);
