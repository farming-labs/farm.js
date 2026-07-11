import type { FarmConfig, FarmContextFactoryInput } from "./types";

export const FARM_ROUTE_CONTEXT_SYMBOL = Symbol.for("farm.routeContext");

export type FarmRouteContextCarrier<TContext = unknown> = {
  [FARM_ROUTE_CONTEXT_SYMBOL]?: TContext;
};

export async function resolveFarmRouteContext(
  config: Pick<FarmConfig, "context">,
  input: FarmContextFactoryInput,
): Promise<unknown> {
  if (typeof config.context !== "function") {
    return undefined;
  }

  return config.context(input);
}

export function withFarmRouteContext<TProps extends object, TContext>(
  props: TProps,
  context: TContext | undefined,
): TProps & FarmRouteContextCarrier<TContext> {
  if (context === undefined) {
    return props as TProps & FarmRouteContextCarrier<TContext>;
  }

  Object.defineProperty(props, FARM_ROUTE_CONTEXT_SYMBOL, {
    value: context,
    enumerable: false,
    configurable: true,
  });

  return props as TProps & FarmRouteContextCarrier<TContext>;
}

export function getFarmRouteContext<TContext = unknown>(props: unknown): TContext | undefined {
  if (!props || typeof props !== "object") {
    return undefined;
  }

  return (props as FarmRouteContextCarrier<TContext>)[FARM_ROUTE_CONTEXT_SYMBOL];
}
