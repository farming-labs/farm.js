import type { Children, LeafElement } from "leaf";
import type { HTMLAttributes } from "leaf/jsx-runtime";
import type {
  DefaultRouteHref,
  FarmClientStore,
  FarmLinkOptions,
  FarmRendererRouter,
  FarmRendererRouterOptions,
  FarmRendererRouterSnapshot,
  FarmRendererTheme,
} from "@farm.js/core/renderer-client";
import type { FarmThemeSnapshot } from "@farm.js/core/theme";

export declare function useFarmStore<T>(store: FarmClientStore<T>): T;

export type LeafRouter = FarmRendererRouterSnapshot &
  Pick<FarmRendererRouter, "push" | "replace" | "refresh" | "prefetch" | "back" | "forward">;
export declare function useRouter(options?: FarmRendererRouterOptions): LeafRouter;

export declare function useTheme(): FarmThemeSnapshot &
  Pick<FarmRendererTheme, "setTheme" | "toggleTheme">;

export type LinkProps<
  TRoute extends string = DefaultRouteHref,
  THref extends string = string,
> = Omit<HTMLAttributes, "href"> & FarmLinkOptions<TRoute, THref> & { children?: Children };
export declare function Link<
  TRoute extends string = DefaultRouteHref,
  THref extends string = string,
>(props: LinkProps<TRoute, THref>): LeafElement;
