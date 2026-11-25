import type { Children, LeafElement } from "leaf";
import type { HTMLAttributes } from "leaf/jsx-runtime";
import type {
  DefaultRouteHref,
  FarmAction,
  FarmActionOptions,
  FarmActionSnapshot,
  FarmClientStore,
  FarmImageOptions,
  FarmLinkOptions,
  FarmRendererRouter,
  FarmRendererRouterOptions,
  FarmRendererQueryOptions,
  FarmRendererQuerySnapshot,
  FarmRendererRouterSnapshot,
  FarmRendererTheme,
} from "@farm.js/core/renderer-client";
import type { ServerFn } from "@farm.js/core/server-fn";
import type { ServerQuery } from "@farm.js/core/server-query";
import type { FarmThemeSnapshot } from "@farm.js/core/theme";

export declare function useFarmStore<T>(store: FarmClientStore<T>): T;

export type LeafRouter = FarmRendererRouterSnapshot &
  Pick<FarmRendererRouter, "push" | "replace" | "refresh" | "prefetch" | "back" | "forward">;
export declare function useRouter(options?: FarmRendererRouterOptions): LeafRouter;

export declare function useTheme(): FarmThemeSnapshot &
  Pick<FarmRendererTheme, "setTheme" | "toggleTheme">;

export type LeafAction<TInput, TResult, TError extends Error = Error> = FarmActionSnapshot<
  TResult,
  TError
> &
  Pick<FarmAction<TInput, TResult, TError>, "submit" | "reset">;
export declare function useAction<TInput, TResult, TError extends Error = Error>(
  target:
    | ServerFn<TInput, TResult, TError>
    | { readonly action: ServerFn<TInput, TResult, TError> },
  options?: FarmActionOptions<TInput, TResult, TError>,
): LeafAction<TInput, TResult, TError>;

export type LeafServerQuery<TData> = FarmRendererQuerySnapshot<TData> & {
  refetch(): Promise<TData>;
};
export declare function useServerQuery<TInput, TData>(
  query: ServerQuery<TInput, TData>,
  input: TInput,
  options?: FarmRendererQueryOptions,
): LeafServerQuery<TData>;

export type LinkProps<
  TRoute extends string = DefaultRouteHref,
  THref extends string = string,
> = Omit<HTMLAttributes, "href"> & FarmLinkOptions<TRoute, THref> & { children?: Children };
export declare function Link<
  TRoute extends string = DefaultRouteHref,
  THref extends string = string,
>(props: LinkProps<TRoute, THref>): LeafElement;

export declare function Image(props: FarmImageOptions): LeafElement;
