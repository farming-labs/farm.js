"use client";

import {
  delegateNavigation,
  type FarmNavigationDelegateContext,
} from "../client/navigation-delegate";
import type { FarmClientPlugin } from "../client/plugin";

/** The part of the native shell's injected `window.__farmBridge` the client uses. */
interface FarmMobileShellBridge {
  /** Show the navigation natively and return true, or return false to navigate in place. */
  offerNavigation?(context: FarmNavigationDelegateContext): boolean;
}

/**
 * @internal The client plugin a `--mobile` client build registers. Inside the native shell, whose
 * bridge script runs before the page, in-app navigations go to the shell's navigator. In a browser
 * there is no bridge and it does nothing.
 */
export const farmMobileShellClient: FarmClientPlugin<(() => void) | undefined> = {
  setup() {
    const bridge = (globalThis as { __farmBridge?: FarmMobileShellBridge }).__farmBridge;
    const offer = bridge?.offerNavigation;
    if (typeof offer !== "function") return undefined;
    return delegateNavigation((context) => offer.call(bridge, context) === true);
  },
  close({ state }) {
    state?.();
  },
};
