// The registry behind the `components.json` that `farm add integration --ui`
// writes. The generated file advertises `https://farmjs.dev/r/{name}.json`, and
// the docs app (farmjs.dev) mounts `handleUIRegistryRequest` at
// `UI_REGISTRY_ROUTE_PATTERN` so that url answers with a real shadcn registry
// item instead of a 404.
//
// Items are serialized from `./ui-component-sources`, the same module
// `installUIFeature` writes files from, so the endpoint and the CLI can never
// describe different component source.

import {
  SHADCN_COMPONENT_NAMES,
  shadcnComponentDependencies,
  shadcnComponentTemplate,
  type ShadcnComponentName,
} from "./ui-component-sources";

/** Schema the served items validate against. */
export const SHADCN_REGISTRY_ITEM_SCHEMA = "https://ui.shadcn.com/schema/registry-item.json";

/** Route pattern the docs app mounts the registry handler at. */
export const UI_REGISTRY_ROUTE_PATTERN = "/r/[item]";

/** Value written into a generated `components.json` as `registries.farm.url`. */
export const UI_REGISTRY_URL_TEMPLATE = "https://farmjs.dev/r/{name}.json";

export interface UIRegistryItemFile {
  path: string;
  content: string;
  type: "registry:ui";
}

export interface UIRegistryItem {
  $schema: string;
  name: ShadcnComponentName;
  type: "registry:ui";
  title: string;
  description: string;
  dependencies?: string[];
  files: UIRegistryItemFile[];
}

const ITEM_TITLES: Record<ShadcnComponentName, string> = {
  badge: "Badge",
  button: "Button",
  card: "Card",
  input: "Input",
  label: "Label",
};

/** Every primitive the registry serves. */
export function listUIRegistryItemNames(): readonly ShadcnComponentName[] {
  return SHADCN_COMPONENT_NAMES;
}

export function isUIRegistryItemName(value: string): value is ShadcnComponentName {
  return (SHADCN_COMPONENT_NAMES as readonly string[]).includes(value);
}

/**
 * Turns a requested path, file name, or bare name into a served item name.
 * Only names on the primitive allowlist resolve, so a traversal or
 * prototype-polluting segment can never reach the item lookup.
 */
export function resolveUIRegistryItemName(request: string): ShadcnComponentName | null {
  const withoutQuery = request.split(/[?#]/, 1)[0] || "";
  const segment = withoutQuery.split("/").pop() || "";
  const name = segment.endsWith(".json") ? segment.slice(0, -".json".length) : segment;

  return isUIRegistryItemName(name) ? name : null;
}

export function createUIRegistryItem(name: ShadcnComponentName): UIRegistryItem {
  const dependencies = shadcnComponentDependencies(name);

  return {
    $schema: SHADCN_REGISTRY_ITEM_SCHEMA,
    name,
    type: "registry:ui",
    title: ITEM_TITLES[name],
    description: `Farm's shadcn-style ${name} primitive, the same source \`farm add integration --ui\` writes to src/components/ui/${name}.tsx.`,
    ...(dependencies.length > 0 ? { dependencies: [...dependencies] } : {}),
    files: [
      {
        path: `registry/ui/${name}.tsx`,
        content: shadcnComponentTemplate(name),
        type: "registry:ui",
      },
    ],
  };
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  // Read-only public JSON consumed by the shadcn CLI and by browsers exploring
  // the registry, so cross-origin reads are allowed.
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400",
} as const;

/**
 * Serves one registry item for a `GET /r/{name}.json` request. Unknown names
 * get a 404 that names what the registry does serve, since a typo in a
 * `shadcn add` invocation is the common failure.
 */
export function handleUIRegistryRequest(request: Request): Response {
  const name = resolveUIRegistryItemName(new URL(request.url).pathname);

  if (!name) {
    return new Response(
      JSON.stringify(
        {
          error: "Unknown registry item.",
          items: [...SHADCN_COMPONENT_NAMES],
        },
        null,
        2,
      ),
      { status: 404, headers: JSON_HEADERS },
    );
  }

  return new Response(JSON.stringify(createUIRegistryItem(name), null, 2), {
    status: 200,
    headers: JSON_HEADERS,
  });
}
