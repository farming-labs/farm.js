// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { setFarmBasePath } from "../base-path";
import { createRendererRouter } from "../renderer-client";
import { _runWithCurrentRequest } from "../server/request";

/**
 * A node environment on purpose. There is no `window`, so the store takes the path the Solid, Vue,
 * and Svelte bindings' router takes while the page renders on the server, as a custom renderer's
 * does.
 */

afterEach(() => {
  setFarmBasePath(undefined);
});

describe("the renderer router store on the server", () => {
  it("runs without a window", () => {
    expect(typeof window).toBe("undefined");
  });

  it("reads the request's path, query, and params rather than the site root", async () => {
    await _runWithCurrentRequest(new Request("https://farmjs.dev/users/42?tab=posts"), () => {
      const snapshot = createRendererRouter({ routes: ["/users/[id]"] }).getSnapshot();
      expect(snapshot.pathname).toBe("/users/42");
      expect(snapshot.searchParams.toString()).toBe("tab=posts");
      expect(snapshot.params).toEqual({ id: "42" });
      expect(snapshot.pageState).toBeNull();
    });
  });

  it("reports the path below the app's base path, as the browser does", async () => {
    setFarmBasePath("/console");
    await _runWithCurrentRequest(new Request("https://farmjs.dev/console/users/42"), () => {
      const snapshot = createRendererRouter({ routes: ["/users/[id]"] }).getSnapshot();
      expect(snapshot.pathname).toBe("/users/42");
      expect(snapshot.params).toEqual({ id: "42" });
    });
  });

  it("falls back to the site root outside a request", () => {
    const snapshot = createRendererRouter().getSnapshot();
    expect(snapshot.pathname).toBe("/");
    expect(snapshot.searchParams.toString()).toBe("");
    expect(snapshot.params).toEqual({});
  });
});
