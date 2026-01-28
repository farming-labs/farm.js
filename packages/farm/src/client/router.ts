import { useState, useEffect } from "react";

interface RouterState {
  pathname: string;
  searchParams: URLSearchParams;
  params: Record<string, string>;
}

/**
 * Hook for accessing router state and navigation
 */
export function useRouter() {
  // Base path is typically "/" for most apps
  // TODO: Support configurable base path via context
  const basePath = "";
  const [state, setState] = useState<RouterState>(() => {
    if (typeof window === "undefined") {
      return {
        pathname: "/",
        searchParams: new URLSearchParams(),
        params: {},
      };
    }

    const url = new URL(window.location.href);
    return {
      pathname: url.pathname.replace(basePath, "") || "/",
      searchParams: url.searchParams,
      params: {}, // This would be populated by the route matcher
    };
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const url = new URL(window.location.href);
      setState({
        pathname: url.pathname.replace(basePath, "") || "/",
        searchParams: url.searchParams,
        params: {}, // This would be populated by the route matcher
      });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [basePath]);

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
