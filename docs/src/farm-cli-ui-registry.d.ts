// `@farm.js/cli` ships no type declarations (its tsdown config keeps `dts`
// disabled), so the registry entry the docs app mounts is declared here the way
// `packages/create-farm-app` declares the entries it imports from the CLI.
declare module "@farm.js/cli/ui-registry" {
  export const UI_REGISTRY_ROUTE_PATTERN: string;
  export const UI_REGISTRY_URL_TEMPLATE: string;
  export function listUIRegistryItemNames(): readonly string[];
  export function handleUIRegistryRequest(request: Request): Response;
}
