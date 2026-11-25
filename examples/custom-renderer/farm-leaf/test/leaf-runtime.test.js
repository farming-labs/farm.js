// @vitest-environment jsdom
import { expect, it } from "vitest";
import { Fragment, Suspense, createElement as h, useState } from "leaf";
import { createRoot, hydrateRoot } from "leaf/dom";
import { renderToReadableStream, renderToString } from "leaf/server";

it("moves each hydrated keyed fragment with its state and both host nodes", () => {
  function Item({ name }) {
    const [initial] = useState(name);
    return h("button", null, initial);
  }
  const tree = (keys) =>
    keys.map((key) => h(Fragment, { key }, h(Item, { name: key }), h("i", null, key)));
  const container = document.createElement("div");
  container.innerHTML = renderToString(tree(["a", "b"]));
  const [a, aLabel, b, bLabel] = container.children;
  const root = hydrateRoot(container, tree(["a", "b"]));
  root.render(tree(["b", "a"]));
  expect(container.firstChild).toBe(b);
  expect([...container.children]).toEqual([b, bLabel, a, aLabel]);
  root.render(tree(["c"]));
  expect(container.firstChild).not.toBe(b);
  expect(container.textContent).toBe("cc");
});

it("attaches refs after placement and clears replaced and unmounted refs", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const seen = [];
  const ref = (node) => seen.push(node ? container.contains(node) : null);
  const object = { current: null };
  const button = h("button", { ref, key: "a" });
  renderToString(button);
  expect(seen).toEqual([]);
  root.render(button);
  const node = container.firstChild;
  root.render(h("button", { ref: object, key: "a" }));
  expect(seen).toEqual([true, null]);
  expect(object.current).toBe(node);
  root.render(h("button", { ref: object, key: "b" }));
  expect(object.current).toBe(container.firstChild);
  expect(object.current).not.toBe(node);
  root.unmount();
  expect(object.current).toBeNull();
});

it("streams the second pending sibling before the first and uses the response nonce", async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const boundary = (gate, label) =>
    h(
      Suspense,
      { fallback: label },
      h(() => gate.promise),
    );
  const reader = renderToReadableStream(
    h("main", null, boundary(first, "waiting A"), boundary(second, "waiting B")),
    { nonce: "test-nonce" },
  ).getReader();
  const read = async () => new TextDecoder().decode((await reader.read()).value);
  try {
    const shell = await read();
    expect(shell).toContain("waiting A");
    expect(shell).toContain("waiting B");
    second.resolve(h("p", null, "second result"));
    const secondChunk = await read();
    expect(secondChunk).toContain("second result");
    expect(secondChunk).not.toContain("first result");
    expect(secondChunk).toContain('nonce="test-nonce"');
    first.resolve(h("p", null, "first result"));
    expect(await read()).toContain("first result");
    expect((await reader.read()).done).toBe(true);
  } finally {
    first.resolve(null);
    second.resolve(null);
    await reader.cancel();
  }
});

it("rejects duplicate keys before replacing a sibling", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  root.render(h("p", { key: 0 }, "original"));
  const duplicate = [h("b", { key: 0 }), h("i", { key: 0 })];
  expect(() => root.render(duplicate)).toThrow(/duplicate sibling key/);
  expect(container.textContent).toBe("original");
  expect(() => renderToString(duplicate)).toThrow(/duplicate sibling key/);
});

it("keeps a failed boundary's fallback and completes its sibling", async () => {
  const error = new Error("crop failed");
  const errors = [];
  const tree = [
    h(
      Suspense,
      { fallback: "unavailable" },
      h(async () => {
        throw error;
      }),
    ),
    h(
      Suspense,
      { fallback: "pending" },
      h(async () => "ripe"),
    ),
  ];
  const html = await new Response(
    renderToReadableStream(tree, { onError: (e) => errors.push(e) }),
  ).text();
  expect(html).toContain("unavailable");
  expect(html).toContain("ripe");
  expect(errors).toEqual([error]);
});

it("cancels a stream with an unresolved boundary without resuming its component tree", async () => {
  const gate = Promise.withResolvers();
  let rendered = false;
  const tree = h(
    Suspense,
    { fallback: "waiting" },
    h(() => gate.promise),
  );
  const reader = renderToReadableStream(tree).getReader();
  await reader.read();
  const pending = reader.read();
  await reader.cancel();
  expect((await pending).done).toBe(true);
  gate.resolve(
    h(() => {
      rendered = true;
      return null;
    }),
  );
  await gate.promise;
  expect(rendered).toBe(false);
});

it("returns resolved, script-free HTML for a buffered consumer", async () => {
  const tree = h(
    Suspense,
    { fallback: "pending" },
    h(async () => h("p", null, "crop")),
  );
  expect(await new Response(renderToReadableStream(tree, { progressive: false })).text()).toBe(
    "<p>crop</p>",
  );
});

it("emits a parent's reveal before a nested boundary that finished earlier", async () => {
  const outer = Promise.withResolvers();
  const inner = Promise.withResolvers();
  const tree = h(Suspense, { fallback: "outer fallback" }, [
    h(
      Suspense,
      { fallback: "inner fallback" },
      h(() => inner.promise),
    ),
    h(() => outer.promise),
  ]);
  const reader = renderToReadableStream(tree).getReader();
  const read = async () => new TextDecoder().decode((await reader.read()).value);
  expect(await read()).toContain("outer fallback");
  inner.resolve("inner content");
  outer.resolve("outer content");
  const parent = await read();
  expect(parent).toContain("outer content");
  expect(parent).toContain("inner fallback");
  expect(await read()).toContain("inner content");
  expect((await reader.read()).done).toBe(true);
});

it("adopts a keyed input and keeps its ref and edited value when a sibling moves", () => {
  const container = document.createElement("div");
  const calls = [];
  const ref = (node) => calls.push(node);
  const field = h("input", { key: 0, ref, defaultValue: "original" });
  const label = h("span", { key: "label" }, "Label");
  container.innerHTML = renderToString([field, label]);
  const input = container.firstChild;
  input.value = "typed before hydration";
  const root = hydrateRoot(container, [field, label]);
  root.render([label, field]);
  expect(calls).toEqual([input]);
  expect(container.lastChild).toBe(input);
  expect(input.value).toBe("typed before hydration");
  root.unmount();
  expect(calls).toEqual([input, null]);
});
