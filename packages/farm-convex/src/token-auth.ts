import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const REFRESH_EVENT = "farm:convex-auth";

/** Re-check the visitor's Convex token, for example right after signing in or out without a reload. */
export function refreshConvexAuth(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REFRESH_EVENT));
}

async function fetchToken(tokenPath: string): Promise<string | null> {
  try {
    const response = await fetch(tokenPath, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const token = typeof payload === "object" && payload ? Reflect.get(payload, "token") : null;
    return typeof token === "string" ? token : null;
  } catch {
    return null;
  }
}

interface TokenAuthState {
  isLoading: boolean;
  token: string | null;
}

type UseTokenAuth = () => {
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>;
};

const hooksByPath = new Map<string, UseTokenAuth>();

function createTokenAuth(tokenPath: string): UseTokenAuth {
  return function useTokenAuth() {
    const [state, setState] = useState<TokenAuthState>({ isLoading: true, token: null });
    const latest = useRef<string | null>(null);

    const check = useCallback(async () => {
      const token = await fetchToken(tokenPath);
      latest.current = token;
      setState((current) =>
        current.isLoading || current.token !== token ? { isLoading: false, token } : current,
      );
    }, []);

    useEffect(() => {
      void check();
      const recheck = () => void check();
      window.addEventListener(REFRESH_EVENT, recheck);
      window.addEventListener("focus", recheck);
      return () => {
        window.removeEventListener(REFRESH_EVENT, recheck);
        window.removeEventListener("focus", recheck);
      };
    }, [check]);

    // A new identity per signed-in token makes Convex fetch again when the visitor changes.
    const fetchAccessToken = useCallback(
      async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
        if (!forceRefreshToken && latest.current) return latest.current;
        const token = await fetchToken(tokenPath);
        latest.current = token;
        return token;
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [state.token],
    );

    return useMemo(
      () => ({
        isLoading: state.isLoading,
        isAuthenticated: state.token !== null,
        fetchAccessToken,
      }),
      [state.isLoading, state.token, fetchAccessToken],
    );
  };
}

/** One stable hook per token path, as ConvexProviderWithAuth expects. */
export function readTokenAuth(tokenPath: string): UseTokenAuth {
  let hook = hooksByPath.get(tokenPath);
  if (!hook) {
    hook = createTokenAuth(tokenPath);
    hooksByPath.set(tokenPath, hook);
  }
  return hook;
}
