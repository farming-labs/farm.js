import { useRouter as useFarmRouter } from "./client/router";

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
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    },
    prefetch(_href: string) {
      return Promise.resolve();
    },
  };
}

export function usePathname(): string {
  return useFarmRouter().pathname;
}

export function useSearchParams(): URLSearchParams {
  return useFarmRouter().searchParams;
}
