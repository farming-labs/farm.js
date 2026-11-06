import { readExtensionService } from "./component.js";
import { forwardRequest } from "./forward.js";

import type { FarmIntegrationRoute } from "@farm.js/core";
import type { ConvexExtension } from "./types.js";

const DEFAULT_METHODS = ["GET", "POST"] as const;

type ExtensionValueKey = "token" | "siteToken" | "tokenPath" | "provider";

function checkSingleOwner(
  extensions: readonly ConvexExtension[],
  keys: readonly ExtensionValueKey[],
  label: string,
  option: string,
) {
  const owners = extensions
    .filter((extension) => keys.some((key) => extension[key] !== undefined))
    .map(({ name }) => name);
  if (owners.length > 1) {
    throw new Error(
      `Convex integration: ${owners.join(" and ")} both ${label}. Keep one, or pass convex({ ${option} }) to choose.`,
    );
  }
}

function checkServiceOwners(extensions: readonly ConvexExtension[]): void {
  const owners = new Map<string, string>();
  for (const extension of extensions) {
    const service = readExtensionService(extension);
    if (!service) continue;
    const other = owners.get(service);
    if (other) {
      throw new Error(
        `Convex integration: ${other} and ${extension.name} both provide ${service}. Keep one.`,
      );
    }
    owners.set(service, extension.name);
  }
}

function checkRoutePaths(extensions: readonly ConvexExtension[]): void {
  const owners = new Map<string, string>();
  for (const { name, routes = [] } of extensions) {
    for (const { path, to } of routes) {
      if (!path.startsWith("/") || (to !== undefined && !to.startsWith("/"))) {
        throw new Error(`Convex integration: ${name} routes must be paths starting with "/".`);
      }
      const owner = owners.get(path);
      if (owner) throw new Error(`Convex integration: ${owner} and ${name} both route ${path}.`);
      owners.set(path, name);
    }
  }
}

export function checkExtensions(extensions: readonly ConvexExtension[]): void {
  checkSingleOwner(extensions, ["token", "siteToken"], "read a visitor token", "token");
  checkSingleOwner(extensions, ["tokenPath"], "set a browser token path", "tokenPath");
  checkSingleOwner(extensions, ["provider"], "set a provider", "provider");
  checkServiceOwners(extensions);
  checkRoutePaths(extensions);
}

export function pickExtensionValue<Key extends ExtensionValueKey>(
  extensions: readonly ConvexExtension[],
  key: Key,
): ConvexExtension[Key] {
  return extensions.find((extension) => extension[key] !== undefined)?.[key];
}

export function createExtensionRoutes(
  extensions: readonly ConvexExtension[],
  siteURL: string,
): FarmIntegrationRoute[] {
  return extensions.flatMap(({ routes = [] }) =>
    routes.map((route) => ({
      path: route.path,
      methods: route.methods ?? DEFAULT_METHODS,
      handler: (request: Request) => forwardRequest(request, siteURL, route.to),
    })),
  );
}
