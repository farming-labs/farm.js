import { useRouter as useFarmRouter } from "./client/router";
import { getRouter as getFarmSPARouter } from "./client/spa-router";
import { applyFarmBasePath } from "./base-path";

export {
  getFarmRedirectError,
  isFarmNotFoundError,
  isFarmRedirectError,
  notFound,
  permanentRedirect,
  redirect,
} from "./navigation-errors";
export type { FarmRedirectSignal, FarmRedirectStatus } from "./navigation-errors";

export function useRouter() {
  const router = useFarmRouter();
  return {
    push: router.push,
    replace: router.replace,
    back: router.back,
    forward: router.forward,
    refresh() {
      if (typeof window === "undefined") return Promise.resolve();
      return getFarmSPARouter().refresh();
    },
    prefetch(href: string) {
      if (typeof window === "undefined") return Promise.resolve();
      return getFarmSPARouter().prefetch(applyFarmBasePath(href));
    },
  };
}

export function usePathname(): string {
  return useFarmRouter().pathname;
}

export function useSearchParams(): URLSearchParams {
  return useFarmRouter().searchParams;
}
