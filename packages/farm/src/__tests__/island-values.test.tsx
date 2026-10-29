import React, { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFarmIsolatedClientBoundary,
  createFarmIsolatedHydrationRuntime,
} from "../client/isolated-boundary";
import { getFarmIslandValueHeaders } from "../client/island-value-protocol";
import { decodeFarmTagged } from "../client/island-codec";
import { getFarmIslandValueStore } from "../client/island-value-store";
import {
  addressFarmValues,
  hashFarmValue,
  installFarmIslandValues,
  parseFarmHeldValues,
  readFarmHeldValues,
  selectFarmValuesToSend,
} from "../client/island-values";
import { _setAppRequestView, _setCurrentRequestResolver } from "../server/request-bridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STORE_KEY = Symbol.for("farm.island-values");
installFarmIslandValues();

// A docs navigation tree: what a layout passes to its sidebar and its mobile menu.
const tree = Array.from({ length: 6 }, (_, section) => ({
  title: `Section ${section}`,
  items: Array.from({ length: 8 }, (_, item) => ({
    title: `Page ${section}.${item} about caching and rendering`,
    href: `/docs/${section}/${item}`,
  })),
}));

function Sidebar({ tree, label }: { tree: typeof treeType; label: string }) {
  return (
    <nav aria-label={label} data-sections={tree.length}>
      {tree[0]!.items[0]!.title}
    </nav>
  );
}
const treeType = tree;

function serve(headers: Record<string, string> = {}) {
  const request = new Request("http://localhost/docs", { headers });
  let reads = 0;
  _setCurrentRequestResolver(() => request);
  _setAppRequestView((current) => {
    return new Proxy(current, {
      get(target, property) {
        if (property === "headers") reads++;
        return Reflect.get(target, property);
      },
    });
  });
  return { reads: () => reads };
}

function valueScripts(html: string): string[] {
  return [...html.matchAll(/<script type="f\/value" name="([0-9a-z]{14})">/g)].map(
    (match) => match[1]!,
  );
}

afterEach(() => {
  _setCurrentRequestResolver(undefined);
  _setAppRequestView(undefined);
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("content-addressed island values", () => {
  it("keys a value by its content", () => {
    const json = JSON.stringify(tree);
    expect(hashFarmValue(json)).toMatch(/^[0-9a-z]{14}$/);
    expect(hashFarmValue(json)).toBe(hashFarmValue(JSON.stringify(structuredClone(tree))));
    expect(hashFarmValue(json)).not.toBe(hashFarmValue(json.replace("Page 0.0", "Page 0.1")));
  });

  it("moves large values out of the props and keeps small ones inline", () => {
    const addressed = addressFarmValues({ tree, label: "Docs", count: 3 });
    const props = JSON.parse(addressed.json);
    expect(props.label).toBe("Docs");
    expect(props.count).toBe(3);
    expect(Object.keys(props.tree)).toEqual(["$", "v"]);
    expect(addressed.roots).toEqual([props.tree.v]);
    expect(addressed.json.length).toBeLessThan(100);
  });

  it("addresses inner values first, so a tree that changes in one place shares the rest", () => {
    const changed = structuredClone(tree);
    changed[5]!.items[7]!.title = "Renamed";
    const before = addressFarmValues({ tree }, 256);
    const after = addressFarmValues({ tree: changed }, 256);
    expect(before.roots).not.toEqual(after.roots);
    const shared = [...after.values.keys()].filter((key) => before.values.has(key));
    // Five of the six sections are unchanged.
    expect(shared).toHaveLength(5);
    // Only the changed section and the root travel again for a browser that held the old tree.
    const send = selectFarmValuesToSend(after, new Set(before.values.keys()));
    expect(send.map((value) => value.key)).toEqual([
      after.roots[0],
      after.values.get(after.roots[0]!)!.children[5],
    ]);
  });

  it("leaves out held values with everything inside them", () => {
    const addressed = addressFarmValues({ tree }, 256);
    expect(selectFarmValuesToSend(addressed, null)).toHaveLength(addressed.values.size);
    expect(selectFarmValuesToSend(addressed, new Set(addressed.roots))).toEqual([]);
  });

  it("reads only well-formed held keys, and caps them", () => {
    const key = hashFarmValue("x");
    expect([...parseFarmHeldValues(`${key}, nope,${"a".repeat(14)}`)]).toEqual([
      key,
      "a".repeat(14),
    ]);
    const many = Array.from({ length: 300 }, (_, index) => hashFarmValue(String(index))).join(",");
    expect(parseFarmHeldValues(many).size).toBe(128);
    expect(parseFarmHeldValues(null).size).toBe(0);
  });

  it("counts held values as a request read, so the HTML never enters a shared cache", () => {
    const plain = serve();
    expect(readFarmHeldValues()).toBeNull();
    expect(plain.reads()).toBe(0);

    const key = hashFarmValue("x");
    const navigation = serve({ "f-values": key });
    expect([...readFarmHeldValues()!]).toEqual([key]);
    readFarmHeldValues();
    expect(navigation.reads()).toBe(1);
  });

  it("renders a value once per island and leaves out what the browser holds", () => {
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Sidebar,
      "/src/sidebar.tsx",
      "Sidebar",
      "load",
      { slots: true, values: true },
    );
    serve();
    const html = renderToString(<Boundary tree={tree} label="Docs" />);
    const [key] = valueScripts(html);
    expect(key).toMatch(/^[0-9a-z]{14}$/);
    // The value script comes before the island, and the props only name it.
    expect(html.indexOf('type="f/value"')).toBeLessThan(html.indexOf("<f-island"));
    const props = /<script type="f\/props" for="[^"]+">([^<]*)<\/script>/.exec(html)![1]!;
    expect(JSON.parse(props)).toEqual({ tree: { $: "r", v: key }, label: "Docs" });

    serve({ "f-values": key! });
    const navigation = renderToString(<Boundary tree={tree} label="Docs" />);
    expect(valueScripts(navigation)).toEqual([]);
    expect(navigation).toContain(`{"tree":{"$":"r","v":"${key}"},"label":"Docs"}`);
    // The server HTML is the same either way.
    expect(navigation.replace(/<script[\s\S]*?<\/script>/g, "")).toBe(
      html.replace(/<script[\s\S]*?<\/script>/g, ""),
    );
  });

  it("keeps the props of other modes unchanged", () => {
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Sidebar,
      "/src/sidebar.tsx",
      "Sidebar",
      "load",
      { slots: true },
    );
    const html = renderToString(<Boundary tree={tree} label="Docs" />);
    expect(valueScripts(html)).toEqual([]);
    expect(html).toContain(JSON.stringify(tree).slice(0, 40));
  });

  it("carries app data that looks like a tag as data", async () => {
    // An object with its own "$" key travels wrapped, so it is never read as a reference.
    const lookalike = [{ title: "x", items: [{ $: "r", v: "04jiw29097x8ki" } as any] }];
    const seen: unknown[] = [];
    function Recording(props: { tree: typeof tree; label: string }) {
      seen.push(props.tree);
      return <Sidebar {...props} />;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Recording,
      "/src/sidebar-lookalike.tsx",
      "default",
      "load",
      { slots: true, values: true },
    );
    serve();
    document.body.innerHTML = renderToString(<Boundary tree={lookalike} label="Docs" />);
    _setCurrentRequestResolver(undefined);
    expect(document.body.innerHTML).toContain('{"$":"o","v":{"$":"r","v":"04jiw29097x8ki"}}');
    seen.length = 0;
    const runtime = createFarmIsolatedHydrationRuntime({
      ReactRuntime: React,
      hydrateRoot,
      load: async () => ({ __farm_client_boundary_originals__: { default: Recording } }),
      schedule: async ({ hydrate }) => hydrate(),
      values: getFarmIslandValueStore(),
      decode: decodeFarmTagged,
    });
    await act(async () => runtime.hydrate(document));
    expect(runtime.rootCount()).toBe(1);
    expect(seen[0]).toEqual(lookalike);
  });

  it("hydrates islands that share a value with one parsed copy", async () => {
    const seen: unknown[] = [];
    function Recording(props: { tree: typeof tree; label: string }) {
      seen.push(props.tree);
      return <Sidebar {...props} />;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Recording,
      "/src/recording.tsx",
      "default",
      "load",
      { slots: true, values: true },
    );
    serve();
    document.body.innerHTML = renderToString(
      <>
        <Boundary tree={tree} label="Desktop" />
        <Boundary tree={tree} label="Mobile" />
      </>,
    );
    _setCurrentRequestResolver(undefined);
    // Each island carries the tree and its sections; the browser reads each key once.
    const scripts = valueScripts(document.body.innerHTML);
    expect(new Set(scripts).size).toBe(7);
    expect(scripts).toHaveLength(14);
    seen.length = 0;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = createFarmIsolatedHydrationRuntime({
      ReactRuntime: React,
      hydrateRoot,
      load: async () => ({ __farm_client_boundary_originals__: { default: Recording } }),
      schedule: async ({ hydrate }) => hydrate(),
      values: getFarmIslandValueStore(),
    });
    await act(async () => runtime.hydrate(document));

    expect(runtime.rootCount()).toBe(2);
    expect(errors).not.toHaveBeenCalled();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(tree);
    expect(seen[0]).toBe(seen[1]);
    // The next navigation names the value, so the server can leave it out.
    expect(getFarmIslandValueHeaders()["F-Values"]!.split(",").sort()).toEqual(
      [...new Set(scripts)].sort(),
    );
  });

  it("ships the addressing only where a server installed it", () => {
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Sidebar,
      "/src/sidebar-client.tsx",
      "Sidebar",
      "load",
      { slots: true, values: true },
    );
    const key = Symbol.for("farm.island-values.server");
    const installed = (globalThis as Record<symbol, unknown>)[key];
    delete (globalThis as Record<symbol, unknown>)[key];
    try {
      const html = renderToString(<Boundary tree={tree} label="Docs" />);
      expect(valueScripts(html)).toEqual([]);
      expect(html).toContain(JSON.stringify(tree).slice(0, 40));
    } finally {
      (globalThis as Record<symbol, unknown>)[key] = installed;
    }
  });

  it("keeps the server HTML when a value never arrived", async () => {
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Sidebar,
      "/src/sidebar-missing.tsx",
      "Sidebar",
      "load",
      { slots: true, values: true },
    );
    serve({ "f-values": "" });
    const html = renderToString(<Boundary tree={tree} label="Docs" />);
    document.body.innerHTML = html.replace(/<script type="f\/value"[\s\S]*?<\/script>/g, "");
    const report = vi.fn();
    const runtime = createFarmIsolatedHydrationRuntime({
      ReactRuntime: React,
      hydrateRoot,
      load: async () => ({ __farm_client_boundary_originals__: { Sidebar } }),
      schedule: async ({ hydrate }) => hydrate(),
      values: getFarmIslandValueStore(),
      report,
    });
    await act(async () => runtime.hydrate(document));
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("Could not hydrate isolated client boundary"),
      expect.objectContaining({
        message: expect.stringMatching(/island value [0-9a-z]{14} was not found/),
      }),
    );
    expect(document.querySelector("nav")?.textContent).toBe(tree[0]!.items[0]!.title);
    expect(getFarmIslandValueStore().heldHeader()).toBeUndefined();
  });
});
