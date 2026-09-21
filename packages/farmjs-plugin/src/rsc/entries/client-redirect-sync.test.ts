import { describe, expect, it, vi } from "vitest";
import { generateClientEntry } from "./client.js";
import type { EntryContext } from "../types.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  globalCssPath: undefined,
  actionsEnabled: true,
  serverActions: { allowedOrigins: [], bodySizeLimit: 500_000 },
  deploymentId: "redirect-test",
  debug: false,
};

// Rebuild the generated refetch() with its free variables supplied as params.
function buildRefetch(deps: Record<string, unknown>) {
  const entry = generateClientEntry(context);
  const start = entry.indexOf("async function refetch(url) {");
  const end = entry.indexOf("const rootElForHydrate", start);
  const source = entry.slice(start, end).trim();
  const names = Object.keys(deps);
  return new Function(...names, `${source}\nreturn refetch;`)(...names.map((n) => deps[n]));
}

function deps(res: any, location: any, history: any) {
  return {
    debug: () => {},
    fetch: vi.fn(async () => res),
    createFarmDeploymentRequestHeaders: () => ({}),
    farmDeploymentId: "redirect-test",
    isFarmDeploymentMismatchResponse: () => false,
    reportDeploymentMismatch: () => {},
    createFromReadableStream: vi.fn(async () => ({ rootContent: null })),
    setPayloadRef: { current: vi.fn() },
    location,
    history,
    console,
  };
}

describe("RSC client navigation reconciles the address bar after a server redirect", () => {
  it("replaces history with the followed redirect target", async () => {
    const history = { replaceState: vi.fn() };
    const location = {
      origin: "https://app.test",
      pathname: "/dashboard",
      search: "",
      hash: "",
      href: "https://app.test/dashboard",
    };
    const res = { ok: true, redirected: true, url: "https://app.test/login", body: {} };
    const d = deps(res, location, history);
    const refetch = buildRefetch(d);

    await refetch("https://app.test/dashboard");

    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/login");
    expect(d.setPayloadRef.current).toHaveBeenCalled();
  });

  it("leaves the address bar untouched when no redirect occurred", async () => {
    const history = { replaceState: vi.fn() };
    const location = {
      origin: "https://app.test",
      pathname: "/dashboard",
      search: "",
      hash: "",
      href: "https://app.test/dashboard",
    };
    const res = { ok: true, redirected: false, url: "https://app.test/dashboard", body: {} };
    const refetch = buildRefetch(deps(res, location, history));

    await refetch("https://app.test/dashboard");

    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
