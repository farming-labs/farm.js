/**
 * `@farm.js/core/navigation` for an app whose renderer isn't React. That entry also exports
 * React's router hooks, so it imports React, which such an app doesn't install. Farm resolves the
 * app's imports of it here instead (`farmNavigationPlugin`): the same `notFound()` and `redirect()`,
 * and hooks that say where to read the route from.
 */
export {
  getFarmRedirectError,
  isFarmNotFoundError,
  isFarmRedirectError,
  notFound,
  permanentRedirect,
  redirect,
} from "./navigation-errors";
export type { FarmRedirectSignal, FarmRedirectStatus } from "./navigation-errors";

function reactHook(name: string): never {
  throw new Error(
    `[Farm] ${name}() from @farm.js/core/navigation is a React hook, and this app's renderer is not React. Read the route from your renderer's bindings instead, such as useRouter() from @farm.js/solid/bindings.`,
  );
}

export function useRouter(): never {
  return reactHook("useRouter");
}

export function usePathname(): never {
  return reactHook("usePathname");
}

export function useSearchParams(): never {
  return reactHook("useSearchParams");
}
