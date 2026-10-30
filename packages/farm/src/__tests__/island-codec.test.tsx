import React, { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createIsland } from "../islx/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeFarmJson,
  decodeFarmTagged,
  encodeFarmJson,
  NOT_A_FARM_MARKER,
} from "../client/island-codec";
import { getFarmIslandValueStore } from "../client/island-value-store";
import { installFarmIslandValues } from "../client/island-values";
// Islands mode runs on islx: the runtime its generated code imports.
import {
  createFarmIsolatedHydrationRuntime,
  createFarmServerTreeElement,
  renderFarmServerTreePage,
} from "../client/islands-runtime";
import {
  FARM_FORM_ACTION_HEADER,
  handleFarmFormActionRequest,
  registerFarmFormAction,
} from "../form-actions";
import { resolveServerActionsConfig } from "../server-action-security";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
installFarmIslandValues();

// Every type JSON cannot hold, as a server component might pass them.
const sample = () => ({
  updated: new Date("2026-10-28T09:00:00.000Z"),
  invalid: new Date(Number.NaN),
  tags: new Set(["new", "sale"]),
  stock: new Map<unknown, unknown>([
    ["sku-1", 3],
    [7, new Date("2026-01-01T00:00:00.000Z")],
  ]),
  id: 12345678901234567890n,
  missing: undefined,
  ratio: Number.NaN,
  limit: Infinity,
  floor: -Infinity,
  sign: -0,
  site: new URL("https://example.com/shop?q=1"),
  pattern: /ab+c/gi,
  bytes: new Uint8Array([0, 1, 254, 255]),
  floats: new Float64Array([1.5, -2.25]),
  buffer: new Uint16Array([1, 65535]).buffer,
  nested: [{ at: new Date("2026-02-03T04:05:06.000Z"), set: new Set([1n]) }],
});

function expectSample(value: any) {
  expect(value.updated).toBeInstanceOf(Date);
  expect(value.updated.toISOString()).toBe("2026-10-28T09:00:00.000Z");
  expect(Number.isNaN(value.invalid.getTime())).toBe(true);
  expect(value.tags).toEqual(new Set(["new", "sale"]));
  expect(value.stock).toBeInstanceOf(Map);
  expect(value.stock.get("sku-1")).toBe(3);
  expect(value.stock.get(7)).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  expect(value.id).toBe(12345678901234567890n);
  expect("missing" in value).toBe(true);
  expect(value.missing).toBeUndefined();
  expect(Number.isNaN(value.ratio)).toBe(true);
  expect(value.limit).toBe(Infinity);
  expect(value.floor).toBe(-Infinity);
  expect(Object.is(value.sign, -0)).toBe(true);
  expect(value.site).toBeInstanceOf(URL);
  expect(value.site.href).toBe("https://example.com/shop?q=1");
  expect(value.pattern).toEqual(/ab+c/gi);
  expect(value.bytes).toEqual(new Uint8Array([0, 1, 254, 255]));
  expect(value.floats).toEqual(new Float64Array([1.5, -2.25]));
  expect(new Uint16Array(value.buffer)).toEqual(new Uint16Array([1, 65535]));
  expect(value.nested[0].at).toEqual(new Date("2026-02-03T04:05:06.000Z"));
  expect(value.nested[0].set).toEqual(new Set([1n]));
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("island codec", () => {
  it("round-trips every type through JSON", () => {
    const json = JSON.stringify(encodeFarmJson(sample()));
    expect(json).toContain('{"$":"D","v":"2026-10-28T09:00:00.000Z"}');
    expect(json).toContain('{"$":"B","v":"12345678901234567890"}');
    expect(json).toContain(
      '{"$":"M","v":[["sku-1",3],[7,{"$":"D","v":"2026-01-01T00:00:00.000Z"}]]}',
    );
    expectSample(decodeFarmJson(JSON.parse(json)));
  });

  it("decodes untrusted input safely", () => {
    const decoded = decodeFarmJson(JSON.parse('{"__proto__":{"admin":true},"a":1}')) as Record<
      string,
      unknown
    >;
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    expect(Object.keys(decoded)).toEqual(["__proto__", "a"]);
    expect(() => decodeFarmJson({ $: "B", v: "1e9" })).toThrow('malformed "B" tag');
    expect(() => decodeFarmJson({ $: "Y", v: ["Window", "AAAA"] })).toThrow("malformed");
    expect(() => decodeFarmJson({ $: "zz" })).toThrow('unknown "zz" tag');
    // A browser cannot smuggle in the runtime's own references.
    expect(() => decodeFarmJson({ $: "a", v: "some-action" })).toThrow("not allowed");
    expect(() => decodeFarmJson({ $: "r", v: "04jiw29097x8ki" })).toThrow("not allowed");
    expect(decodeFarmTagged({ $: "r", v: "x" }, (value) => value)).toBe(NOT_A_FARM_MARKER);
  });

  it("wraps app data that looks like a tag, and refuses values it cannot carry", () => {
    // App data with its own "$" key travels wrapped and comes back as it was.
    const lookalike = { $: "D", v: "not a date", note: 1 };
    const wrapped = encodeFarmJson(lookalike);
    expect(wrapped).toEqual({ $: "o", v: { $: "D", v: "not a date", note: 1 } });
    expect(decodeFarmJson(JSON.parse(JSON.stringify(wrapped)))).toEqual(lookalike);
    expect(() => encodeFarmJson({ run: () => {} })).toThrow("function values");
    class Point {}
    expect(() => encodeFarmJson(new Point())).toThrow("class instances");
  });
});

describe("typed props", () => {
  function ShowSource(props: ReturnType<typeof sample>) {
    return (
      <output
        data-show
      >{`${props.updated.toISOString()} ${[...props.tags].join(",")} ${props.id}`}</output>
    );
  }
  const seen: unknown[] = [];
  function Recording(props: ReturnType<typeof sample>) {
    seen.push(props);
    return <ShowSource {...props} />;
  }
  const Show = createIsland(Recording, "/src/show.tsx", "Show", "load");

  it("reach an island as the types the server passed", async () => {
    const html = renderToString(<Show {...sample()} />);
    expect(html).toContain('{"$":"D","v":"2026-10-28T09:00:00.000Z"}');
    expect(html).toContain("f-island");
    document.body.innerHTML = html;
    seen.length = 0;
    const runtime = createFarmIsolatedHydrationRuntime({
      ReactRuntime: React,
      hydrateRoot,
      load: async () => ({
        Show: Recording,
        __farm_client_boundary_originals__: { Show: Recording },
      }),
      schedule: async ({ hydrate }) => hydrate(),
      decode: decodeFarmTagged,
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => runtime.hydrate(document));
    expect(errors).not.toHaveBeenCalled();
    expect(runtime.rootCount()).toBe(1);
    expectSample(seen[0]);
  });

  it("reach a server-tree page's client component as the same types", async () => {
    async function Page() {
      await Promise.resolve();
      return <Show {...sample()} />;
    }
    const page = await renderFarmServerTreePage(React, <Page />, {
      isolate: (node) => node,
      values: true,
    });
    const html = renderToString(<div id="__farm_page__">{page}</div>);
    expect(html).toContain('{"$":"B","v":"12345678901234567890"}');
    const container = Object.assign(document.createElement("div"), { innerHTML: html });
    seen.length = 0;
    const element = await createFarmServerTreeElement(
      React,
      container.querySelector("#__farm_page__")!,
      {
        load: async () => ({
          Show: Recording,
          __farm_client_boundary_originals__: { Show: Recording },
        }),
        ServerHtml: () => null,
        decode: decodeFarmTagged,
        values: getFarmIslandValueStore(),
      },
    );
    const target = document.createElement("div");
    document.body.append(target);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(target);
    await act(async () => root.render(element));
    expectSample(seen.at(-1));
    expect(target.querySelector("[data-show]")!.textContent).toBe(
      "2026-10-28T09:00:00.000Z new,sale 12345678901234567890",
    );
    act(() => root.unmount());
  });
});

describe("typed server action calls", () => {
  it("keeps argument and result types", async () => {
    let received: unknown[] = [];
    registerFarmFormAction(async (...args: unknown[]) => {
      received = args;
      return { at: new Date("2026-10-28T10:00:00.000Z"), ids: new Set([1n, 2n]) };
    }, "typed-rpc");
    const response = await handleFarmFormActionRequest(
      new Request("https://app.test/todos", {
        method: "POST",
        headers: {
          [FARM_FORM_ACTION_HEADER]: "typed-rpc",
          "content-type": "text/plain;charset=UTF-8",
          origin: "https://app.test",
        },
        // islx's call body: the arguments, tagged, under "a".
        body: JSON.stringify({
          a: encodeFarmJson([new Date("2026-01-01T00:00:00.000Z"), new Map([["k", 9n]])]),
        }),
      }),
      resolveServerActionsConfig(undefined),
    );
    expect(response?.status).toBe(200);
    expect(received[0]).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(received[1]).toEqual(new Map([["k", 9n]]));
    const { result } = (await response!.json()) as { result: unknown };
    const decoded = decodeFarmJson(result) as { at: Date; ids: Set<bigint> };
    expect(decoded.at).toEqual(new Date("2026-10-28T10:00:00.000Z"));
    expect(decoded.ids).toEqual(new Set([1n, 2n]));
  });

  it("answers malformed arguments with 400", async () => {
    const action = vi.fn();
    registerFarmFormAction(action, "typed-bad");
    const response = await handleFarmFormActionRequest(
      new Request("https://app.test/todos", {
        method: "POST",
        headers: {
          [FARM_FORM_ACTION_HEADER]: "typed-bad",
          "content-type": "text/plain;charset=UTF-8",
          origin: "https://app.test",
        },
        body: JSON.stringify({ a: [{ $: "B", v: "not a number" }] }),
      }),
      resolveServerActionsConfig(undefined),
    );
    expect(response?.status).toBe(400);
    expect(action).not.toHaveBeenCalled();
  });
});
