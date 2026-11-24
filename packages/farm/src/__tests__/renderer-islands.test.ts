// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { assertFarmRendererServerModule } from "../renderer";
import { resolveFarmIsland, type FarmIslandReference } from "../renderer-entry";
import { usesFarmRendererIslands } from "../renderer-islands";
import * as reactServer from "../renderer/react/server";
import { _setCurrentRequestResolver } from "../server/request-bridge";
import { transformIsolatedClientBoundaryModule } from "../vite";

/**
 * RFC 0012: a renderer that declares `capabilities.islands` exports `withIsland`, which Farm wraps
 * each export of a client module with in the server graph. It calls `resolveFarmIsland` for the
 * parts to write; the browser hydrates them with islx's runtime through the renderer's own
 * `createElement` and `hydrateRoot`. The leaf example's e2e covers the browser.
 */
const reference: FarmIslandReference = {
  src: "/src/components/counter.tsx",
  export: "Counter",
  strategy: "idle",
};

afterEach(() => {
  _setCurrentRequestResolver(undefined);
  vi.restoreAllMocks();
});

function duringRequest(): void {
  const request = new Request("https://farm.test/islands");
  _setCurrentRequestResolver(() => request);
}

describe("resolveFarmIsland", () => {
  it("gives the island's element, its props script, and its props without client:*", () => {
    duringRequest();
    const island = resolveFarmIsland({ label: "Plant", "client:visible": true }, reference)!;
    expect(island.props).toEqual({ label: "Plant" });
    expect(island.values).toEqual([]);
    expect(island.element).toEqual({
      tag: "f-island",
      attributes: {
        src: "/src/components/counter.tsx",
        export: "Counter",
        props: "fi0",
        strategy: "visible",
        style: "display:contents",
      },
    });
    expect(island.script).toEqual({
      attributes: { type: "f/props", for: "fi0" },
      text: '{"label":"Plant"}',
    });
  });

  it("uses the module's strategy without a client:* attribute, and load without either", () => {
    duringRequest();
    expect(resolveFarmIsland({}, reference)!.element.attributes.strategy).toBe("idle");
    expect(
      resolveFarmIsland({}, { ...reference, strategy: undefined as never })!.element.attributes
        .strategy,
    ).toBe("load");
  });

  it("takes a bare attribute as Vue compiles it, and skips an undefined one", () => {
    duringRequest();
    const island = resolveFarmIsland(
      { "client:interaction": "", "client:load": undefined },
      reference,
    )!;
    expect(island.element.attributes.strategy).toBe("interaction");
    expect(island.props).toEqual({});
  });

  it("numbers islands per request, so ids never repeat in a response", () => {
    duringRequest();
    const first = resolveFarmIsland({}, reference)!;
    const second = resolveFarmIsland({}, reference)!;
    expect([first.element.attributes.props, second.element.attributes.props]).toEqual([
      "fi0",
      "fi1",
    ]);
    duringRequest();
    expect(resolveFarmIsland({}, reference)!.element.attributes.props).toBe("fi0");
    // A render outside a request still gets ids of its own.
    _setCurrentRequestResolver(undefined);
    expect(resolveFarmIsland({}, reference)!.element.attributes.props).toMatch(/^fi-\d+$/);
  });

  it("sends a value several islands of a response share once", () => {
    duringRequest();
    const notes = "wheat ".repeat(200);
    const first = resolveFarmIsland({ notes }, reference)!;
    const second = resolveFarmIsland({ notes }, reference)!;
    expect(first.values).toHaveLength(1);
    expect(first.values[0]!.attributes.type).toBe("f/value");
    expect(second.values).toEqual([]);
    expect(second.script.text).toBe(first.script.text);
    // A new response sends it again.
    duringRequest();
    expect(resolveFarmIsland({ notes }, reference)!.values).toHaveLength(1);
  });

  it("encodes Dates and Maps through islx's codec", () => {
    duringRequest();
    const island = resolveFarmIsland(
      { since: new Date("2026-03-01T00:00:00.000Z"), crops: new Map([["wheat", 3]]) },
      reference,
    )!;
    expect(JSON.parse(island.script.text)).toEqual({
      since: { $: "D", v: "2026-03-01T00:00:00.000Z" },
      crops: { $: "M", v: [["wheat", 3]] },
    });
  });

  it("returns undefined for props the browser can't rebuild, and says why once", () => {
    duringRequest();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const props = { onPlant: function onPlant() {} };
    expect(resolveFarmIsland(props, reference)).toBeUndefined();
    expect(resolveFarmIsland(props, reference)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe(
      "[Farm.js] Counter (/src/components/counter.tsx) cannot get its props in the browser: " +
        "functions are not serializable (onPlant): pass a server action, or move the function " +
        "into the client component. The server-rendered component was preserved without client " +
        "hydration.",
    );
  });

  it("refuses a client:* attribute that isn't one strategy without a value", () => {
    duringRequest();
    expect(() => resolveFarmIsland({ "client:only": true }, reference)).toThrow(
      "`client:only` on Counter (/src/components/counter.tsx) is not an island strategy. Use " +
        "`client:load`, `client:idle`, `client:visible` or `client:interaction`.",
    );
    expect(() => resolveFarmIsland({ "client:visible": "200px" }, reference)).toThrow(
      "`client:visible` on Counter (/src/components/counter.tsx) takes no value. Write " +
        "`client:visible` alone.",
    );
    expect(() =>
      resolveFarmIsland({ "client:load": true, "client:idle": true }, reference),
    ).toThrow(
      "Counter (/src/components/counter.tsx) has two strategies, `client:load` and " +
        "`client:idle`. Keep one.",
    );
  });
});

describe("capabilities.islands", () => {
  const renderer = {
    name: "plain",
    vite: "plain-renderer/vite",
    server: "plain-renderer/server",
    client: "plain-renderer/client",
  };

  it("requires withIsland from the server module of a renderer that declares it", () => {
    const runtime = { ...reactServer, name: "plain" };
    expect(() =>
      assertFarmRendererServerModule(runtime, { ...renderer, capabilities: { islands: true } }),
    ).toThrow(
      "Renderer `plain` server module `plain-renderer/server` does not export `withIsland`. " +
        "Its descriptor declares `capabilities.islands`, which needs `withIsland`.",
    );
    expect(() =>
      assertFarmRendererServerModule(
        { ...runtime, withIsland: (component: unknown) => component },
        { ...renderer, capabilities: { islands: true } },
      ),
    ).not.toThrow();
    expect(() => assertFarmRendererServerModule(runtime, renderer)).not.toThrow();
  });

  it("applies only with isolated hydration on, outside islands mode, on a renderer besides React", () => {
    const islands = { ...renderer, capabilities: { islands: true } };
    const enabled = { isolatedClientHydration: "enabled" };
    expect(usesFarmRendererIslands({ renderer: islands, experimental: enabled })).toBe(true);
    expect(usesFarmRendererIslands({ renderer: islands })).toBe(false);
    expect(usesFarmRendererIslands({ renderer, experimental: enabled })).toBe(false);
    expect(usesFarmRendererIslands({ experimental: enabled })).toBe(false);
    expect(
      usesFarmRendererIslands({
        renderer: islands,
        experimental: { ...enabled, serverComponents: { mode: "islands" } },
      }),
    ).toBe(false);
  });

  it("wraps each component export with the renderer's withIsland in the server graph", async () => {
    const { parseSync } = await import("vite");
    const code = transformIsolatedClientBoundaryModule({
      code: [
        '"use client";',
        'export const island = "idle";',
        "export function Counter() { return null; }",
        "export default function Panel() { return null; }",
      ].join("\n"),
      moduleReference: "/src/components/counter.tsx",
      islandStrategy: "idle",
      parse: (source) =>
        (parseSync("counter.tsx", source) as { program: unknown }).program as never,
      withIsland: "plain-renderer/server",
    })!;
    expect(code).toContain(
      'import { withIsland as __farm_renderer_with_island__ } from "plain-renderer/server";',
    );
    expect(code).toContain(
      '__farm_with_island__(Counter, { src: "/src/components/counter.tsx", export: "Counter", strategy: "idle" })',
    );
    expect(code).toContain('export: "default", strategy: "idle" })');
    expect(code).not.toContain("islx-react");
    expect(code).not.toContain("isolated-boundary");
  });
});
