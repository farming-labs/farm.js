import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createFarmRouter, type FarmRouter, type FarmRouterRouteInput } from "../router";
import {
  getInstalledFarmSPARouter,
  getRouter as getSPARouter,
  readPageState,
  type FarmNavigationBlockerContext,
  type FarmNavigationState,
} from "./spa-router";
import { notifyHistoryChange, subscribeHistoryChange } from "./history-sync";
import { getFarmI18nClientState } from "../i18n/client-runtime";
import { _resolveCurrentRequest } from "../server/request-bridge";
import { stripFarmLocaleFromPathname } from "../i18n/routing";
import {
  applyFarmBasePath,
  getFarmBasePath,
  normalizeFarmBasePath,
  stripFarmBasePath,
} from "../base-path";

interface RouterState {
  pathname: string;
  searchParams: URLSearchParams;
  params: Record<string, string>;
  pageState: unknown;
}

export interface UseRouterOptions {
  basePath?: string;
  routes?: FarmRouterRouteInput[];
}

export interface UseBlockerOptions {
  when: boolean | ((context: FarmNavigationBlockerContext) => boolean);
  message?: string;
  shouldBlock?: (context: FarmNavigationBlockerContext) => boolean | Promise<boolean>;
}

export interface UseBlockerReturn {
  active: boolean;
}

function shouldBlockUnload(options: UseBlockerOptions): boolean {
  const path = window.location.pathname + window.location.search;
  const context: FarmNavigationBlockerContext = {
    from: path,
    to: path,
    action: "replace",
  };
  const when = typeof options.when === "function" ? options.when(context) : options.when;
  if (!when) return false;
  if (!options.shouldBlock) return true;

  try {
    const result = options.shouldBlock(context);
    if (typeof result === "boolean") return result;
    void result.catch(() => undefined);
    return true;
  } catch {
    return true;
  }
}

/**
 * Hook for accessing router state and navigation
 */
/**
 * Imperative navigation for useRouter. Delegates to the installed SPA router
 * so blockers run before the URL changes, history state is written by the
 * router, and the action is labelled push/replace rather than pop. Without a
 * Farm router (embedded usage) the URL is written directly and announced on
 * the shared history channel, whose no-router fallback is the nuqs-style
 * synthetic popstate this code previously hand-rolled.
 */
function navigateViaRouter(href: string, basePath: string, replace: boolean): void {
  if (typeof window === "undefined") return;

  const url = applyFarmBasePath(href, basePath);
  const spaRouter = getInstalledFarmSPARouter();
  if (spaRouter) {
    void spaRouter.navigate(url, { replace });
    return;
  }

  if (replace) {
    window.history.replaceState(null, "", url);
  } else {
    window.history.pushState(null, "", url);
  }
  notifyHistoryChange("url-search");
}

export function useRouter(options: UseRouterOptions = {}) {
  const basePath =
    options.basePath === undefined ? getFarmBasePath() : normalizeFarmBasePath(options.basePath);
  const routes = options.routes;
  const routeKey =
    routes?.map((route) => (typeof route === "string" ? route : route.path)).join("\n") || "";
  const routeMatcher = useMemo(
    () => (routeKey ? createFarmRouter(routeKey.split("\n")) : null),
    [routeKey],
  );
  const [state, setState] = useState<RouterState>(() => {
    return readRouterState(basePath, routeMatcher);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      setState(readRouterState(basePath, routeMatcher));
    };

    handlePopState();
    const unsubscribe = subscribeHistoryChange(handlePopState);
    return unsubscribe;
  }, [basePath, routeMatcher]);

  const push = (href: string) => {
    navigateViaRouter(href, basePath, false);
  };

  const replace = (href: string) => {
    navigateViaRouter(href, basePath, true);
  };

  const pushState = <TState>(pageState: TState, href?: string) => {
    if (typeof window === "undefined") return;
    getSPARouter().pushState(pageState, resolveClientHref(href, basePath));
  };

  const replaceState = <TState>(pageState: TState, href?: string) => {
    if (typeof window === "undefined") return;
    getSPARouter().replaceState(pageState, resolveClientHref(href, basePath));
  };

  const back = () => {
    if (typeof window !== "undefined") {
      window.history.back();
    }
  };

  const forward = () => {
    if (typeof window !== "undefined") {
      window.history.forward();
    }
  };

  return {
    ...state,
    push,
    replace,
    pushState,
    replaceState,
    back,
    forward,
  };
}

export function usePageState<TState = unknown>(): TState | null {
  const [state, setState] = useState<TState | null>(() => readPageState<TState>());

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      setState(readPageState<TState>());
    };

    handlePopState();
    return subscribeHistoryChange(handlePopState);
  }, []);

  return state;
}

export function useNavigation(): FarmNavigationState {
  const [state, setState] = useState<FarmNavigationState>(() =>
    getSPARouter().getNavigationState(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    return getSPARouter().subscribeNavigation(setState);
  }, []);

  return state;
}

export function useBlocker(options: UseBlockerOptions): UseBlockerReturn {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const active = Boolean(options.when);

  useEffect(() => {
    if (typeof window === "undefined" || !active) {
      return;
    }

    return getSPARouter().addBlocker(
      async (context) => {
        const current = optionsRef.current;
        const when = typeof current.when === "function" ? current.when(context) : current.when;

        if (!when) return false;

        if (current.shouldBlock && !(await current.shouldBlock(context))) {
          return false;
        }

        if (current.message && typeof window.confirm === "function") {
          return !window.confirm(current.message);
        }

        return true;
      },
      () => shouldBlockUnload(optionsRef.current),
    );
  }, [active]);

  return { active };
}

export function useScrollRestoration<TElement extends HTMLElement = HTMLElement>(
  key: string,
): RefObject<TElement | null> {
  const ref = useRef<TElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return getSPARouter().registerScrollElement(key, element);
  }, [key]);

  return ref;
}

function readRouterState(basePath: string, routeMatcher: FarmRouter | null): RouterState {
  const url = readCurrentUrl();
  if (!url) {
    return {
      pathname: "/",
      searchParams: new URLSearchParams(),
      params: {},
      pageState: null,
    };
  }

  const pathname = normalizeClientPathname(url.pathname, basePath);
  const i18n = getFarmI18nClientState();
  const routePathname = i18n ? stripFarmLocaleFromPathname(pathname, i18n) : pathname;
  return {
    pathname,
    searchParams: url.searchParams,
    params: routeMatcher?.match(routePathname)?.params || {},
    pageState: typeof window === "undefined" ? null : readPageState(),
  };
}

/**
 * The URL being rendered, on either side of hydration.
 *
 * On the server this came back as `/` with no search params, so a component
 * reading the path or the query string rendered one thing on the server and
 * another in the browser, which React reports as a hydration mismatch and
 * leaves the route without useful server rendered markup.
 */
function readCurrentUrl(): URL | undefined {
  if (typeof window !== "undefined") {
    try {
      return new URL(window.location.href);
    } catch {
      return undefined;
    }
  }

  const request = _resolveCurrentRequest();
  if (!request) return undefined;
  try {
    return new URL(request.url);
  } catch {
    return undefined;
  }
}

function normalizeClientPathname(pathname: string, basePath: string) {
  return stripFarmBasePath(pathname, basePath);
}

function resolveClientHref(href: string | undefined, basePath: string): string | undefined {
  if (!href) return undefined;
  return applyFarmBasePath(href, basePath);
}
