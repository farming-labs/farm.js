/**
 * @internal The browser side of server functions in apps whose renderer is not React (see
 * `resolveFarmIslxActionsMode`). A browser module's import of a server function becomes a reference
 * made here, and calling it posts the call to the page. Server queries fill and invalidate Farm's
 * query cache as they do in islands mode, and a redirect from an action navigates on the client.
 * Nothing here imports React.
 */
import {
  createServerReference as createIslxServerReference,
  setActionInterceptor,
  setActionNavigator,
} from "@farm.js/islx/client";
import { farmIslandsActionInterceptor } from "../islands-action-client";

type Router = { navigate?(href: string): Promise<void> };

let installed = false;

function installActions(): void {
  if (installed) return;
  installed = true;
  setActionInterceptor(farmIslandsActionInterceptor);
  // No `refresh`: the page has no server tree to fetch again, so a component shows what an action
  // changed from the result it returns.
  setActionNavigator({
    navigate(href) {
      const router = (window as Window & { __FARM_SPA_ROUTER__?: Router }).__FARM_SPA_ROUTER__;
      return router?.navigate ? router.navigate(href) : location.assign(href);
    },
  });
}

export function createServerReference(
  ...args: Parameters<typeof createIslxServerReference>
): ReturnType<typeof createIslxServerReference> {
  installActions();
  return createIslxServerReference(...args);
}
