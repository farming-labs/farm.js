import type { App } from "vue";

export interface FarmVueAppContext {
  /** True while rendering on the server, false in the browser. */
  ssr: boolean;
}

/**
 * Configures each Vue app Farm creates: one per server render and one per hydrated root in the
 * browser. Install plugins with `app.use()` here.
 */
export type FarmVueAppSetup = (app: App, context: FarmVueAppContext) => void;

export function validateFarmVueAppSetup(setup: unknown): FarmVueAppSetup | undefined {
  if (setup === undefined) return undefined;
  if (typeof setup !== "function") {
    throw new TypeError(
      "The Vue app setup module must default-export a function: export default defineVueApp((app) => { ... }).",
    );
  }
  return setup as FarmVueAppSetup;
}
