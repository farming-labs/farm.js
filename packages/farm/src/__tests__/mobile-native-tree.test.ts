// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  farmNativeClassProblem,
  resolveFarmNativeClasses,
  resolveFarmNativeInlineStyle,
} from "../mobile/native-style";
import { createFarmNativeTree, createFarmNativeTreeResponse } from "../mobile/native-tree";

const page = (body: string, head = "<title>Notes</title>") =>
  `<!DOCTYPE html><html><head>${head}</head><body><div id="root"><nav>site chrome</nav>` +
  `<div id="__farm_page__" data-farm-segment="page">${body}</div></div>` +
  `<script>window.__FARM_PROPS__ = {"a":"<p>not markup</p>"}</script></body></html>`;

describe("native tier styles", () => {
  it("resolves the Tailwind subset to native values from the default theme", () => {
    expect(resolveFarmNativeClasses("flex items-center gap-2 px-4 py-2.5 text-lg").style).toEqual({
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      rowGap: 8,
      columnGap: 8,
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 10,
      paddingBottom: 10,
      fontSize: 18,
      lineHeight: 28,
    });
    // v4 colors are oklch; native views get sRGB hex, alpha appended.
    expect(resolveFarmNativeClasses("bg-red-500 text-gray-50/50").style).toEqual({
      backgroundColor: "#fb2c36",
      color: "#f9fafb80",
    });
    expect(resolveFarmNativeClasses("w-1/2 max-w-md rounded-lg border-b").style).toEqual({
      width: "50%",
      maxWidth: 448,
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
      borderBottomRightRadius: 8,
      borderBottomLeftRadius: 8,
      borderBottomWidth: 1,
    });
  });

  it("lets a narrower utility win whatever the class order, as Tailwind does", () => {
    expect(resolveFarmNativeClasses("px-4 p-2").style).toMatchObject({
      paddingTop: 8,
      paddingLeft: 16,
    });
    expect(resolveFarmNativeClasses("flex-col flex").style.flexDirection).toBe("column");
  });

  it("keeps dark: apart and reports what the native tier cannot draw", () => {
    expect(resolveFarmNativeClasses("text-gray-900 dark:text-white")).toEqual({
      style: { color: "#101828" },
      dark: { color: "#ffffff" },
      unsupported: [],
    });
    expect(
      resolveFarmNativeClasses("grid md:flex hover:bg-red-500 w-[13px] absolute").unsupported,
    ).toEqual(["grid", "md:flex", "hover:bg-red-500", "w-[13px]", "absolute"]);
    expect(farmNativeClassProblem("flex-wrap")).toBe('class "flex-wrap" has no native-tier style');
    expect(farmNativeClassProblem("dark:bg-gray-900")).toBeUndefined();
  });

  it("reads inline styles as React renders them", () => {
    expect(
      resolveFarmNativeInlineStyle(
        "padding:12px 8px;background-color:rgba(0, 0, 0, 0.5);border-radius:4px;display:grid",
      ),
    ).toEqual({
      style: {
        paddingTop: 12,
        paddingRight: 8,
        paddingBottom: 12,
        paddingLeft: 8,
        backgroundColor: "#00000080",
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        borderBottomRightRadius: 4,
        borderBottomLeftRadius: 4,
      },
      unsupported: ["display: grid"],
    });
  });
});

describe("native tier tree", () => {
  const url = new URL("https://notes.example.com/notes");

  it("reads only the page, with inherited text styles and absolute links", () => {
    const tree = createFarmNativeTree(
      page(
        `<main class="flex flex-col gap-4 p-4 text-gray-900 dark:text-white">` +
          `<h1 class="text-2xl font-bold">Notes &amp; ideas</h1>` +
          `<ul><li><a href="/notes/1">First <strong>note</strong></a></li></ul>` +
          `<a class="rounded-lg bg-blue-600 p-3" href="new"><span>New</span></a>` +
          `<img src="/cover.png" alt="Cover" class="h-40 w-full">` +
          `<p class="hidden">gone</p></main>`,
      ),
      url,
    );
    expect(tree.unsupported).toEqual([]);
    expect(tree.title).toBe("Notes");
    const main = tree.root.children![0]!;
    expect(main).toMatchObject({
      type: "View",
      tag: "main",
      style: { display: "flex", flexDirection: "column", rowGap: 16 },
    });
    const [heading, list, button, image] = main.children as any[];
    // Text styles flow down to the text, as CSS inheritance does.
    expect(heading).toEqual({
      type: "Text",
      tag: "h1",
      style: { color: "#101828", fontSize: 24, lineHeight: 32, fontWeight: 700 },
      dark: { color: "#ffffff" },
      children: ["Notes & ideas"],
    });
    const link = list.children[0].children[0];
    expect(link).toMatchObject({ type: "Text", tag: "#text" });
    expect(link.children[0]).toMatchObject({
      type: "Text",
      tag: "a",
      href: "https://notes.example.com/notes/1",
      children: [
        "First ",
        { type: "Text", tag: "strong", style: { fontWeight: 700 }, children: ["note"] },
      ],
    });
    expect(button).toMatchObject({
      type: "Pressable",
      href: "https://notes.example.com/new",
      style: { backgroundColor: "#155dfc", paddingTop: 12 },
    });
    expect(image).toEqual({
      type: "Image",
      tag: "img",
      style: { height: 160, width: "100%" },
      src: "https://notes.example.com/cover.png",
      alt: "Cover",
    });
    // Layout chrome and script strings are not part of the screen.
    expect(JSON.stringify(tree)).not.toContain("site chrome");
    expect(JSON.stringify(tree)).not.toContain("not markup");
  });

  it("makes each child of a flex container an item, as CSS does", () => {
    const tree = createFarmNativeTree(
      page(
        `<a href="/notes/1" class="flex flex-col gap-1 rounded-xl p-4">` +
          `<span class="text-lg font-semibold">Grocery run</span>` +
          `<span class="self-start rounded-full bg-emerald-100 px-2 py-0.5 text-xs">home</span></a>`,
      ),
      url,
    );
    expect(tree.unsupported).toEqual([]);
    const card = tree.root.children![0]!;
    expect(card).toMatchObject({ type: "Pressable", href: "https://notes.example.com/notes/1" });
    expect(card.children).toEqual([
      expect.objectContaining({ type: "Text", tag: "span", children: ["Grocery run"] }),
      expect.objectContaining({
        type: "Text",
        tag: "span",
        style: expect.objectContaining({ alignSelf: "flex-start", backgroundColor: "#d0fae5" }),
        children: ["home"],
      }),
    ]);
    // Outside a flex container a box-styled span stays inline, which the tree cannot draw yet.
    expect(
      createFarmNativeTree(page(`<p>a <span class="rounded bg-gray-100 px-1">b</span></p>`), url)
        .unsupported,
    ).toEqual(["<span> inside text has box styles"]);
  });

  it("puts streamed Suspense content in place", () => {
    const html = page(
      `<div><!--$?--><template id="B:0"></template><p>Loading…</p><!--/$--></div>`,
    ).replace(
      "</body>",
      `<div hidden id="S:0"><p>Loaded</p></div><script>$RC("B:0","S:0")</script></body>`,
    );
    expect(JSON.stringify(createFarmNativeTree(html, url).root)).toContain("Loaded");
  });

  it("lists what it cannot express, so the shell shows the web screen", () => {
    const tree = createFarmNativeTree(
      page(`<div class="grid"><table><tr><td>x</td></tr></table><p>a <div>b</div></p></div>`),
      url,
    );
    expect(tree.unsupported).toEqual([
      '<div> class "grid"',
      "<table>",
      "<p> holds block elements",
      "<div> inside text",
    ]);
  });

  it("answers with the tree, and passes redirects and errors through", async () => {
    const response = await createFarmNativeTreeResponse({
      request: new Request(url, { headers: { accept: "application/vnd.farm.native+json" } }),
      renderPage: (request) => {
        expect(request.headers.get("accept")).toBe("text/html");
        return new Response(page("<p>hi</p>"), {
          headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "a=1" },
        });
      },
    });
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.farm.native+json; charset=utf-8",
    );
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("set-cookie")).toBe("a=1");
    expect((await response.json()).root.children[0]).toMatchObject({ type: "Text", tag: "p" });

    const redirect = new Response(null, { status: 302, headers: { location: "/login" } });
    expect(
      await createFarmNativeTreeResponse({
        request: new Request(url),
        renderPage: () => redirect,
      }),
    ).toBe(redirect);
  });
});
