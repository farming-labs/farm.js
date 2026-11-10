import type { FarmClientNavigationSession } from "./plugin";

/**
 * What the production client entry needs from `FarmClientPluginManager` in an app with no client
 * plugins: a navigation supersedes the one before it, and rendering waits for a painted frame.
 */
export function createPluginlessClientRuntime() {
  let current: { controller: AbortController; session: FarmClientNavigationSession } | undefined;
  const nothing = async (): Promise<void> => {};
  const clear = (session: FarmClientNavigationSession) => {
    if (current?.session === session) current = undefined;
  };

  return {
    start: nothing,
    beginHydration: nothing,
    completeHydration: nothing,
    failHydration: nothing,
    markNavigationLoaded: nothing,
    resolveNavigation: nothing,
    reportError: nothing,
    close: nothing,
    getPlugins: () => [],

    async beginNavigation(): Promise<FarmClientNavigationSession> {
      current?.controller.abort("superseded");
      const controller = new AbortController();
      // Nothing reads the rest of a session without plugins.
      const session = { signal: controller.signal } as FarmClientNavigationSession;
      current = { controller, session };
      return session;
    },

    cancelNavigation(session?: FarmClientNavigationSession, reason: unknown = "canceled"): void {
      if (!current || (session && current.session !== session)) return;
      current.controller.abort(reason);
      current = undefined;
    },

    scheduleNavigationRendered(session: FarmClientNavigationSession): Promise<void> {
      if (session.signal.aborted) return Promise.resolve();
      return new Promise((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!session.signal.aborted) clear(session);
            resolve();
          }),
        );
      });
    },

    async failNavigation(session: FarmClientNavigationSession): Promise<void> {
      clear(session);
    },
  };
}
