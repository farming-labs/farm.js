// @vitest-environment node
import { describe, expect, it } from "vitest";
import { shouldEmitFarmClientRootHmr } from "../vite";
import { REACT_RENDERER } from "../renderer";

const solidLike = {
  name: "solid",
  vite: "@farm.js/solid/vite",
  server: "@farm.js/solid/server",
  client: "@farm.js/solid/client",
  capabilities: { streaming: { node: true, web: true }, reconcilesRerenders: false },
};

const vueLike = {
  name: "vue",
  vite: "@farm.js/vue/vite",
  server: "@farm.js/vue/server",
  client: "@farm.js/vue/client",
  capabilities: { streaming: { node: true, web: true }, reconcilesRerenders: true },
};

describe("client-root HMR is only emitted for renderers that diff", () => {
  it("emits for React", () => {
    expect(shouldEmitFarmClientRootHmr(REACT_RENDERER)).toBe(true);
    // The default renderer is React, so an unset renderer keeps today's path.
    expect(shouldEmitFarmClientRootHmr(undefined)).toBe(true);
  });

  it("emits for another reconciling renderer", () => {
    expect(shouldEmitFarmClientRootHmr(vueLike)).toBe(true);
  });

  it("does not emit for a rebuilding renderer", () => {
    // Solid's render() disposes and replaces, so a root re-render on every
    // edit would destroy all page state. solid-refresh preserves it instead,
    // and it can only run if Farm leaves the module unaccepted.
    expect(shouldEmitFarmClientRootHmr(solidLike)).toBe(false);
  });
});
