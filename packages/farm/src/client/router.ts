import { useEffect, useMemo, useState } from "react";
import { createFarmRouter, type FarmRouter, type FarmRouterRouteInput } from "../router";

interface RouterState {
  pathname: string;
  searchParams: URLSearchParams;
  params: Record<string, string>;
}

export interface UseRouterOptions {
  basePath?: string;
  routes?: FarmRouterRouteInput[];
}

/**
 * Hook for accessing router state and navigation
 */
export function useRouter(options: UseRouterOptions = {}) {
  const basePath = options.basePath || "";
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
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [basePath, routeMatcher]);

  const push = (href: string) => {
    if (typeof window === "undefined") return;

    const url = href.startsWith("/") ? basePath + href : href;
    window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const replace = (href: string) => {
    if (typeof window === "undefined") return;

    const url = href.startsWith("/") ? basePath + href : href;
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
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
    back,
    forward,
  };
}

function readRouterState(basePath: string, routeMatcher: FarmRouter | null): RouterState {
  if (typeof window === "undefined") {
    return {
      pathname: "/",
      searchParams: new URLSearchParams(),
      params: {},
    };
  }

  const url = new URL(window.location.href);
  const pathname = normalizeClientPathname(url.pathname, basePath);
  return {
    pathname,
    searchParams: url.searchParams,
    params: routeMatcher?.match(pathname)?.params || {},
  };
}

function normalizeClientPathname(pathname: string, basePath: string) {
  const normalizedBase = basePath.replace(/\/+$/, "");
  const isUnderBase =
    normalizedBase && (pathname === normalizedBase || pathname.startsWith(`${normalizedBase}/`));
  const withoutBase = isUnderBase ? pathname.slice(normalizedBase.length) || "/" : pathname;
  return withoutBase || "/";
}
