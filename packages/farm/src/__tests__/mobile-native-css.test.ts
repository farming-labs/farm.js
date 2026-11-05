// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFarmNativeTree, type FarmNativeNode } from "../mobile/native-tree";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The example app's real stylesheet: variables, dark mode, shorthands, element and descendant rules.
const exampleCss = fs.readFileSync(
  path.join(packageRoot, "../../examples/mobile/src/app/globals.css"),
  "utf8",
);
const url = new URL("https://notes.example.com/notes");
const page = (body: string) =>
  `<!DOCTYPE html><html><head><title>Notes</title></head><body><div id="root">` +
  `<nav class="web-tabs"><a href="/">Home</a></nav><div id="__farm_page__">${body}</div></div></body></html>`;

function byTag(node: FarmNativeNode, tag: string): FarmNativeNode[] {
  const out: FarmNativeNode[] = node.tag === tag ? [node] : [];
  for (const child of node.children ?? []) {
    if (typeof child !== "string") out.push(...byTag(child, tag));
  }
  return out;
}

describe("app CSS in the native tier", () => {
  const notes =
    `<main class="page"><h1 class="page-title">Notes</h1><p class="meta">3 notes</p>` +
    `<ul class="list"><li><a class="row" href="/notes/1">Groceries<span>today</span></a></li>` +
    `<li><a class="row" href="/notes/2">Hike<span>Saturday</span></a></li></ul>` +
    `<p class="error">Offline</p></main>`;

  it("cascades the example's rules, variables, and dark mode", () => {
    const tree = createFarmNativeTree(page(notes), url, [exampleCss]);
    expect(tree.unsupported).toEqual([]);
    // body { background: var(--bg) } is the screen's background, light and dark.
    expect(tree.root.style).toEqual({ backgroundColor: "#f7f7f4" });
    expect(tree.root.dark).toEqual({ backgroundColor: "#141614" });
    const [main] = byTag(tree.root, "main");
    expect(main!.style).toMatchObject({
      maxWidth: 640,
      marginLeft: "auto",
      marginRight: "auto",
      paddingTop: 16,
    });
    const [title] = byTag(tree.root, "h1");
    // body { color: var(--text) } flows down; .page-title sets its own size and margins.
    expect(title!.style).toMatchObject({
      color: "#1c1f1d",
      fontSize: 26,
      marginTop: 8,
      marginBottom: 4,
    });
    expect(title!.dark).toMatchObject({ color: "#e8ebe7" });
    const meta = byTag(tree.root, "p")[0]!;
    expect(meta.style).toMatchObject({ color: "#5d645f", fontSize: 14 });
    expect(meta.dark).toMatchObject({ color: "#a3aaa4" });
    const [list] = byTag(tree.root, "ul");
    expect(list!.style).toMatchObject({
      borderTopWidth: 1,
      borderTopColor: "#dcdfd9",
      borderTopLeftRadius: 10,
      backgroundColor: "#ffffff",
      overflow: "hidden",
    });
    expect(list!.dark).toMatchObject({ borderTopColor: "#313731", backgroundColor: "#1d211e" });
    // .list li + li: only the second item draws the divider.
    const items = byTag(tree.root, "li");
    expect(items[0]!.style?.borderTopWidth).toBeUndefined();
    expect(items[1]!.style).toMatchObject({ borderTopWidth: 1, borderTopColor: "#dcdfd9" });
    // .row is a flex column; .row span is muted and smaller.
    const [row] = byTag(tree.root, "a");
    expect(row!.style).toMatchObject({ display: "flex", flexDirection: "column", rowGap: 2 });
    const span = byTag(row!, "span")[0]!;
    expect(span.style).toMatchObject({ color: "#5d645f", fontSize: 14 });
    // Its own color holds in dark mode too: body's dark text color does not override it.
    expect(byTag(tree.root, "p")[1]!.style).toMatchObject({ color: "#c0392b" });
    expect(byTag(tree.root, "p")[1]!.dark?.color ?? "#c0392b").toBe("#c0392b");
  });

  it("wraps .actions, and reports what the cascade cannot express", () => {
    const tree = createFarmNativeTree(
      page(`<div class="actions"><a class="button" href="/new">New</a></div>`),
      url,
      [exampleCss],
    );
    expect(tree.unsupported).toEqual([]);
    expect(byTag(tree.root, "div")[1]!.style).toMatchObject({
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: 8,
    });
    const sticky = createFarmNativeTree(page(`<p class="bar">x</p>`), url, [
      ".bar { position: sticky; top: 0 }",
    ]);
    // The shell shows the web screen for a page with these.
    expect(sticky.unsupported).toEqual(["<p> position: sticky", "<p> top: 0"]);
  });

  it("matches compounds and siblings, ignores hover, and reports other media", () => {
    const css = `
      :root { --accent: #1f6f43; }
      .button { color: white; background: var(--accent); }
      .button.secondary { background: transparent; color: var(--accent); }
      .button:hover { background: black; }
      .tabs > a:first-child { font-weight: 700; }
      @media (min-width: 900px) { .wide { padding: 40px; } }
    `;
    const tree = createFarmNativeTree(
      page(
        `<div class="tabs"><a class="button" href="/a">A</a><a class="button secondary" href="/b">B</a></div>`,
      ),
      url,
      [css],
    );
    expect(tree.unsupported).toEqual([]);
    const [first, second] = byTag(tree.root, "a");
    // Box styles stay on the link; text styles reach its text.
    expect(first!.style).toEqual({ backgroundColor: "#1f6f43" });
    expect((first!.children![0] as FarmNativeNode).style).toMatchObject({
      color: "#ffffff",
      fontWeight: 700,
    });
    expect(second!.style).toEqual({ backgroundColor: "transparent" });
    expect((second!.children![0] as FarmNativeNode).style?.fontWeight).toBeUndefined();
    // The text inherits the link's color.
    expect((second!.children![0] as FarmNativeNode).style).toMatchObject({ color: "#1f6f43" });

    expect(createFarmNativeTree(page(`<p class="wide">x</p>`), url, [css]).unsupported).toEqual([
      '<p> selector "@media (min-width: 900px) .wide"',
    ]);
  });

  it("reads the background shorthand as a build minifies it", () => {
    // A production build writes `background: transparent` as `background:0 0`.
    const css = `.row{background:#fff}.row.plain{background:0 0}.row.none{background:none}`;
    const tree = createFarmNativeTree(
      page(`<p class="row plain">a</p><p class="row none">b</p><p class="row">c</p>`),
      url,
      [css],
    );
    expect(tree.unsupported).toEqual([]);
    expect(byTag(tree.root, "p").map((p) => p.style?.backgroundColor)).toEqual([
      "transparent",
      "transparent",
      "#fff",
    ]);
    expect(
      createFarmNativeTree(page(`<p class="hero">x</p>`), url, [".hero{background:url(a.png)}"])
        .unsupported,
    ).toEqual(["<p> background: url(a.png)"]);
  });

  it("leaves layered Tailwind classes to the table, and ignores classes no rule styles", () => {
    const css = `@layer utilities { .grid { display: grid; } .p-4 { padding: calc(var(--spacing) * 4); } }`;
    const tree = createFarmNativeTree(
      page(`<div class="p-4 notes-list"><p>a</p></div><div class="grid"><p>b</p></div>`),
      url,
      [css],
    );
    expect(tree.unsupported).toEqual(['<div> class "grid"']);
    expect(byTag(tree.root, "div")[1]!.style).toMatchObject({ paddingTop: 16 });
  });
});
