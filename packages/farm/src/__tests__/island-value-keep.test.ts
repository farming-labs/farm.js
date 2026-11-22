import { afterEach, describe, expect, it } from "vitest";
import {
  FARM_MAX_HELD_VALUES,
  getFarmIslandValueHeaders,
  keepFarmIslandValues,
} from "../client/island-value-protocol";
import { getFarmIslandValueStore } from "../client/island-value-store";

const STORE_KEY = Symbol.for("islx.values");

function key(index: number): string {
  return `k${String(index).padStart(13, "0")}`;
}

function value(index: number): string {
  return `<script type="f/value" name="${key(index)}">{"n":${index}}</script>`;
}

function valueKeys(root: ParentNode): string[] {
  return [...root.querySelectorAll('script[type="f/value"]')].map(
    (script) => script.getAttribute("name")!,
  );
}

/** A route whose layout hydrates as one root: layout trees, then the page and its tree. */
function treePage(pageValues: string, page = "<article>page</article>"): string {
  return `<script type="f/tree" name="/">{}</script>
    <main><script type="f/tree" name="/shop">{}</script>
      <div id="__farm_page__" data-farm-client="false">${page}${pageValues}<script type="f/tree">{}</script></div>
    </main>`;
}

function render(html: string): HTMLElement {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById("root")!;
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
  document.body.innerHTML = "";
});

describe("island values held before islx loads", () => {
  it("names the value scripts the page holds", () => {
    const root = render(treePage(value(1) + value(2)));
    expect(getFarmIslandValueHeaders(root)).toEqual({ "F-Values": `${key(1)},${key(2)}` });
    // Without a root to read, a navigation names nothing, as before.
    expect(getFarmIslandValueHeaders()).toEqual({});
    expect(getFarmIslandValueHeaders(render("<p>no values</p>"))).toEqual({});
  });

  it("names the latest keys up to the header's limit, each once", () => {
    const scripts = Array.from({ length: FARM_MAX_HELD_VALUES + 2 }, (_, index) => value(index));
    const root = render(`<div>${value(0)}${scripts.join("")}</div>`);
    const named = getFarmIslandValueHeaders(root)["F-Values"]!.split(",");
    expect(named).toHaveLength(FARM_MAX_HELD_VALUES);
    expect(new Set(named).size).toBe(FARM_MAX_HELD_VALUES);
    expect(named[0]).toBe(key(2));
    expect(named.at(-1)).toBe(key(FARM_MAX_HELD_VALUES + 1));
  });

  it("puts the values the next page leaves out back into its tree's value run", () => {
    const root = render(treePage(value(1) + value(2)));
    const keep = keepFarmIslandValues(root);
    // The server left out key 1, which the request named, and sent key 3.
    root.innerHTML = treePage(value(3), "<article>next</article>");
    keep();

    const page = document.getElementById("__farm_page__")!;
    const run = [...page.children].map(
      (child) => child.getAttribute("name") ?? child.getAttribute("type") ?? child.tagName,
    );
    // Right before the page's tree, which renders the run before it again (server-tree.ts).
    expect(run).toEqual(["ARTICLE", key(3), key(1), key(2), "f/tree"]);
    expect(valueKeys(root)).toEqual([key(3), key(1), key(2)]);
    expect(page.querySelector(`script[name="${key(1)}"]`)!.textContent).toBe('{"n":1}');
  });

  it("does not repeat a value the next page sent again", () => {
    const root = render(treePage(value(1) + value(2)));
    const keep = keepFarmIslandValues(root);
    root.innerHTML = treePage(value(2));
    keep();
    expect(valueKeys(root)).toEqual([key(2), key(1)]);
  });

  it("keeps values in a page without a tree, which no React root hydrates", () => {
    const root = render(`<div id="__farm_page__" data-farm-client="false">${value(1)}</div>`);
    const keep = keepFarmIslandValues(root);
    root.innerHTML = `<header>nav</header><div id="__farm_page__" data-farm-client="false"><p>next</p></div>`;
    keep();
    const page = document.getElementById("__farm_page__")!;
    expect(page.lastElementChild!.getAttribute("name")).toBe(key(1));
  });

  it("keeps values out of a client page React hydrates", () => {
    const root = render(`<div id="__farm_page__" data-farm-client="false">${value(1)}</div>`);
    const keep = keepFarmIslandValues(root);
    root.innerHTML = `<div id="__farm_page__" data-farm-client="true"><p>client</p></div>`;
    keep();
    expect(valueKeys(root)).toEqual([]);
    expect(document.body.lastElementChild!.getAttribute("name")).toBe(key(1));
  });

  it("leaves keeping to islx's store once it has loaded", () => {
    const store = getFarmIslandValueStore();
    const root = render(treePage(value(1)));
    const keep = keepFarmIslandValues(root);
    root.innerHTML = treePage("");
    keep();
    // The store read the value before the swap, and the page gains no markup.
    expect(valueKeys(document)).toEqual([]);
    expect(store.heldHeader()).toBe(key(1));
    expect(getFarmIslandValueHeaders(root)).toEqual({ "F-Values": key(1) });
  });
});
