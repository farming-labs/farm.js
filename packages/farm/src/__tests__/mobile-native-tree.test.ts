// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createFarmNativeTheme,
  farmNativeClassProblem,
  resolveFarmNativeClasses,
  resolveFarmNativeInlineStyle,
} from "../mobile/native-style";
import {
  createFarmNativeTree,
  createFarmNativeTreeResponse,
  type FarmNativeNode,
} from "../mobile/native-tree";

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
    expect(farmNativeClassProblem("absolute")).toBe('class "absolute" has no native-tier style');
    expect(farmNativeClassProblem("dark:bg-gray-900")).toBeUndefined();
  });

  it("resolves classes against an app's @theme, light and dark", () => {
    const theme = createFarmNativeTheme(
      [
        ["--color-brand", "oklch(52.7% 0.154 150.069)"],
        ["--color-surface", "var(--surface)"],
        ["--spacing", "0.5rem"],
        ["--radius-card", "12px"],
        ["--text-tiny", "10px"],
        ["--text-hero", "3rem"],
        ["--text-hero--line-height", "calc(3.5 / 3)"],
        ["--color-gray-*", "initial"],
      ],
      { light: { "--surface": "#ffffff" }, dark: { "--surface": "#1d211e" } },
    );
    expect(
      resolveFarmNativeClasses("bg-brand p-4 rounded-card text-hero bg-surface", theme),
    ).toEqual({
      style: {
        backgroundColor: "#ffffff",
        paddingTop: 32,
        paddingRight: 32,
        paddingBottom: 32,
        paddingLeft: 32,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        borderBottomRightRadius: 12,
        borderBottomLeftRadius: 12,
        fontSize: 48,
        lineHeight: 56,
      },
      // The surface variable changes in dark mode, so its class does too.
      dark: { backgroundColor: "#1d211e" },
      unsupported: [],
    });
    expect(resolveFarmNativeClasses("bg-brand", theme).style).toEqual({
      backgroundColor: "#008236",
    });
    // A custom size without a line height sets only the size, as Tailwind does.
    expect(resolveFarmNativeClasses("text-tiny", theme).style).toEqual({ fontSize: 10 });
    // `--color-gray-*: initial` removes the grays; other colors stay.
    expect(farmNativeClassProblem("text-gray-500", theme)).toBe(
      'class "text-gray-500" has no native-tier style',
    );
    expect(farmNativeClassProblem("text-red-500", theme)).toBeUndefined();
    // An explicit dark: class wins over the theme's dark value.
    expect(resolveFarmNativeClasses("bg-surface dark:bg-brand", theme).dark).toEqual({
      backgroundColor: "#008236",
    });
    // The default table is untouched.
    expect(farmNativeClassProblem("bg-brand")).toBe('class "bg-brand" has no native-tier style');
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
      dark: {},
      unsupported: ["display: grid"],
    });
  });
});

describe("native tier tree", () => {
  const url = new URL("https://notes.example.com/notes");

  it("resolves var() in inline styles from the app's variables, or their fallback", () => {
    // @farm.js/ui writes its color tokens this way: <Text color="muted"> on a server screen.
    expect(resolveFarmNativeInlineStyle("color:var(--farm-color-muted, #6b7280)")).toEqual({
      style: { color: "#6b7280" },
      dark: {},
      unsupported: [],
    });
    const vars = {
      light: { "--farm-color-muted": "#475569", "--gap": "12px" },
      dark: { "--farm-color-muted": "#94A3B8" },
    };
    expect(
      resolveFarmNativeInlineStyle(
        "color:var(--farm-color-muted, #6b7280);row-gap:var(--gap);column-gap:var(--gap)",
        vars,
      ),
    ).toEqual({
      style: { color: "#475569", rowGap: 12, columnGap: 12 },
      // Only what the dark theme changes.
      dark: { color: "#94a3b8" },
      unsupported: [],
    });
    // A variable without a value or fallback stays unsupported, so the shell shows the web screen.
    expect(resolveFarmNativeInlineStyle("color:var(--missing)").unsupported).toEqual([
      "color: var(--missing)",
    ]);
  });

  it("draws @farm.js/ui color tokens on a server screen instead of falling back", () => {
    const url = new URL("https://app.test/");
    const html = page(`<span style="color:var(--farm-color-muted, #6b7280)">One page.tsx</span>`);
    const plain = createFarmNativeTree(html, url);
    expect(plain.unsupported).toEqual([]);
    // The span is an inline run of the page's text block.
    const run = (tree: typeof plain) =>
      (tree.root.children?.[0] as typeof tree.root)?.children?.[0];
    expect(run(plain)).toMatchObject({ tag: "span", style: { color: "#6b7280" } });
    const themed = createFarmNativeTree(html, url, [
      ":root{--farm-color-muted:#475569}" +
        "@media (prefers-color-scheme: dark){:root{--farm-color-muted:#94a3b8}}",
    ]);
    expect(themed.unsupported).toEqual([]);
    expect(run(themed)).toMatchObject({
      style: { color: "#475569" },
      dark: { color: "#94a3b8" },
    });
  });

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
      heading: 1,
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

  it("titles a page without <title> by its first heading", () => {
    const tree = createFarmNativeTree(
      page(`<main><h1>Field <em>notes</em></h1><h1>Later</h1></main>`, ""),
      url,
    );
    expect(tree.title).toBe("Field notes");
    expect(createFarmNativeTree(page("<p>none</p>", ""), url).title).toBeUndefined();
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
      page(`<div class="grid"><canvas></canvas><p>a <div>b</div></p></div>`),
      url,
    );
    expect(tree.unsupported).toEqual([
      '<div> class "grid"',
      "<canvas>",
      "<p> holds block elements",
      "<div> inside text",
    ]);
  });

  it("draws a table as rows whose cells share the width, colspan a wider share", () => {
    const tree = createFarmNativeTree(
      page(
        `<table class="w-full table-fixed border-collapse"><caption>Plans</caption>` +
          `<colgroup><col><col></colgroup>` +
          `<thead><tr><th>Plan</th><th colspan="2">Price</th></tr></thead>\n` +
          `<tbody><tr><td>Free</td><td style="width: 40px">$0</td><td><a href="/x">Pick</a></td></tr></tbody></table>`,
      ),
      url,
    );
    expect(tree.unsupported).toEqual([]);
    const table = tree.root.children?.[0] as FarmNativeNode;
    expect(table).toMatchObject({ type: "View", tag: "table", style: { width: "100%" } });
    const [caption, thead, tbody] = table.children as FarmNativeNode[];
    expect(caption).toMatchObject({
      type: "Text",
      style: { textAlign: "center" },
      children: ["Plans"],
    });
    const header = (thead.children as FarmNativeNode[])[0];
    expect(header).toMatchObject({ tag: "tr", style: { flexDirection: "row" } });
    expect(header.children).toMatchObject([
      {
        tag: "th",
        style: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
        children: [{ type: "Text", style: { fontWeight: 700, textAlign: "center" } }],
      },
      { tag: "th", style: { flexGrow: 2, flexShrink: 1, flexBasis: 0 } },
    ]);
    const cells = ((tbody.children as FarmNativeNode[])[0].children ?? []) as FarmNativeNode[];
    // A cell with its own width keeps it.
    expect(cells.map((cell) => cell.style)).toEqual([
      { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
      { flexGrow: 0, flexShrink: 0, width: 40 },
      { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    ]);
    expect(JSON.stringify(cells[2])).toContain('"href":"https://notes.example.com/x"');
  });

  it("keeps the web screen for a table a native row cannot hold", () => {
    const unsupported = (body: string) => createFarmNativeTree(page(body), url).unsupported;
    expect(
      unsupported(`<table><tr><td rowspan="2">a</td><td>b</td></tr><tr><td>c</td></tr></table>`),
    ).toEqual(['<td> rowspan="2"']);
    expect(unsupported(`<table><tr><td>a</td></tr>stray</table>`)).toEqual([
      "text directly inside <table>",
    ]);
    expect(unsupported(`<table><div>a</div></table>`)).toEqual(["<div> inside <table>"]);
    expect(unsupported(`<table><colgroup><col style="width: 30%"></colgroup></table>`)).toEqual([
      "<col> sets column styles",
    ]);
    expect(unsupported(`<div><td>a</td></div>`)).toEqual(["<td> outside a row"]);
  });

  it("keeps the web screen for a button or field nothing submits", () => {
    // A shell only opens links: a tap on this button, or text typed here, would go nowhere.
    const tree = createFarmNativeTree(
      page(`<button class="px-4">Save</button><input placeholder="Title"><textarea>a</textarea>`),
      url,
    );
    expect(tree.unsupported).toEqual([
      "<button> has no link or form to submit",
      "<input> has no form to submit it",
      "<textarea> has no form to submit it",
    ]);
    // A link still draws, and a hidden input draws nothing, as in a browser.
    const links = createFarmNativeTree(
      page(`<a href="/notes/1">Open</a><input type="hidden" name="id" value="1">`),
      url,
    );
    expect(links.unsupported).toEqual([]);
    expect(JSON.stringify(links.root)).not.toContain("TextInput");
  });

  it("draws a form with its fields and submit buttons, as a browser would send it", () => {
    const tree = createFarmNativeTree(
      page(
        `<form method="post" action="/api/notes#top" class="flex flex-col gap-2">` +
          `<input type="hidden" name="list" value="inbox">` +
          `<input type="hidden" value="no name, not sent">` +
          `<label>Title<input name="title" required maxlength="120" placeholder="Title"></label>` +
          `<label>Body <textarea name="body">Hello</textarea></label>` +
          `<input type="email" name="email" value="a@b.c" disabled>` +
          `<button name="intent" value="save">Save</button>` +
          `<button formaction="/api/drafts" formmethod="get" formenctype="multipart/form-data">Draft</button>` +
          `<button disabled>Archive</button>` +
          `<input type="submit" value="Send">` +
          `</form>`,
      ),
      url,
    );
    expect(tree.unsupported).toEqual([]);
    const form = tree.root.children![0]!;
    expect(form).toMatchObject({
      type: "View",
      tag: "form",
      form: {
        action: "https://notes.example.com/api/notes",
        method: "post",
        fields: [{ name: "list", value: "inbox" }],
      },
    });
    const [title, body, email, save, draft, archive, send] = form.children!;
    // A label wrapping a field is a box: its text, then the field.
    expect(title).toMatchObject({
      type: "View",
      tag: "label",
      children: [
        { type: "Text", children: ["Title"] },
        { type: "TextInput", name: "title", required: true, maxLength: 120, placeholder: "Title" },
      ],
    });
    expect(body!.children![1]).toMatchObject({
      type: "TextInput",
      name: "body",
      multiline: true,
      value: "Hello",
    });
    expect(email).toMatchObject({ inputType: "email", disabled: true, value: "a@b.c" });
    expect(save).toMatchObject({ type: "Pressable", submit: { name: "intent", value: "save" } });
    expect(draft).toMatchObject({
      submit: {
        action: "https://notes.example.com/api/drafts",
        method: "get",
        enctype: "multipart/form-data",
      },
    });
    expect(archive).toMatchObject({ type: "Pressable", disabled: true });
    expect(archive!.submit).toBeUndefined();
    expect(send).toMatchObject({
      type: "Pressable",
      submit: {},
      children: [{ type: "Text", children: ["Send"] }],
    });

    // No action or method: a GET to this page, as in a browser.
    const search = createFarmNativeTree(page(`<form><input type="search" name="q"></form>`), url);
    expect(search.root.children![0]!.form).toEqual({ action: url.href, method: "get" });
    expect(
      createFarmNativeTree(page(`<form enctype="multipart/form-data" method="POST"></form>`), url)
        .root.children![0]!.form,
    ).toEqual({ action: url.href, method: "post", enctype: "multipart/form-data" });
  });

  it("keeps the web screen for a form only JavaScript or another control can submit", () => {
    const tree = createFarmNativeTree(
      page(
        // React renders a client function action as a javascript: URL.
        `<form action="javascript:throw new Error('React form unexpectedly submitted.')"></form>` +
          `<form method="dialog"><button type="button">Close</button><button type="reset">Reset</button></form>` +
          `<form target="_blank"><input type="checkbox" name="done"><form></form></form>` +
          `<input name="q" form="search">`,
      ),
      url,
    );
    expect(tree.unsupported).toEqual([
      `<form> action "javascript:throw new Error('React form unexpectedly submitted.')"`,
      '<form> method "dialog"',
      '<button type="button">',
      '<button type="reset">',
      '<form> target="_blank"',
      '<input type="checkbox">',
      "<form> inside a form",
      '<input> form="search"',
      "<input> has no form to submit it",
    ]);
  });

  it("sends a submitted form to the page or route, and answers with what it rendered", async () => {
    const seen: Array<{ method: string; body: string; type: string | null }> = [];
    const submit = (renderPage: (request: Request) => Response | Promise<Response>) =>
      createFarmNativeTreeResponse({
        request: new Request(url, {
          method: "POST",
          headers: {
            accept: "application/vnd.farm.native+json",
            "content-type": "application/x-www-form-urlencoded",
            origin: url.origin,
          },
          body: "title=Hi&intent=save",
        }),
        renderPage: async (request) => {
          seen.push({
            method: request.method,
            body: await request.text(),
            type: request.headers.get("content-type"),
          });
          return renderPage(request);
        },
        loadStylesheet: () => "",
      });
    const rendered = await submit(
      () =>
        new Response(page("<p>Saved</p>"), {
          headers: {
            "content-type": "text/html",
            "cache-control": "public, max-age=60",
            "set-cookie": "flash=saved",
          },
        }),
    );
    expect(seen).toEqual([
      { method: "POST", body: "title=Hi&intent=save", type: "application/x-www-form-urlencoded" },
    ]);
    // The answer is this submission's result: never cached, and it keeps what the route set.
    expect(rendered.headers.get("cache-control")).toBe("no-store");
    expect(rendered.headers.get("set-cookie")).toBe("flash=saved");
    expect((await rendered.json()).root.children[0]).toMatchObject({ children: ["Saved"] });
    // A form re-rendered with its errors is drawn too, with its status.
    const invalid = await submit(
      () =>
        new Response(page("<p>Title is required</p>"), {
          status: 422,
          headers: { "content-type": "text/html" },
        }),
    );
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).root.children[0]).toMatchObject({
      children: ["Title is required"],
    });
    // A GET's error page is still the web screen's to show.
    const missing = new Response(page("<p>Not found</p>"), {
      status: 404,
      headers: { "content-type": "text/html" },
    });
    expect(
      await createFarmNativeTreeResponse({ request: new Request(url), renderPage: () => missing }),
    ).toBe(missing);
    // Post/redirect/get: the shell follows the redirect itself.
    const redirect = new Response(null, { status: 303, headers: { location: "/notes/1" } });
    expect(await submit(() => redirect)).toBe(redirect);
  });

  it("carries headings, labels, and hidden content for screen readers", () => {
    const tree = createFarmNativeTree(
      page(
        `<h2>Reports</h2><p role="heading" aria-level="3">Latest</p>` +
          `<a href="/x" aria-label="Open the Creek Loop trail"><img src="/a.png" alt=""></a>` +
          `<img src="/b.png" alt="Map of the loop"><p aria-hidden="true">decoration</p>` +
          `<p hidden>not shown</p>` +
          `<form method="post"><label>Your name <input name="name"></label>` +
          `<label for="report">Report &amp; notes</label><textarea id="report" name="text"></textarea>` +
          `<input name="tag" aria-label="Tag"><button>Post</button></form>`,
      ),
      url,
    );
    expect(tree.unsupported).toEqual([]);
    const [h2, latest, link, map, decoration, form] = tree.root.children as FarmNativeNode[];
    expect(h2).toMatchObject({ type: "Text", heading: 2 });
    expect(latest).toMatchObject({ type: "Text", heading: 3 });
    expect(link).toMatchObject({ label: "Open the Creek Loop trail" });
    expect(link!.children![0]).toMatchObject({ type: "Image", hidden: true });
    expect(map).toMatchObject({ type: "Image", alt: "Map of the loop" });
    expect(map!.hidden).toBeUndefined();
    // Drawn, as a browser shows it, and hidden from screen readers; `hidden` is not drawn at all.
    expect(decoration).toMatchObject({ type: "Text", hidden: true, children: ["decoration"] });
    expect(JSON.stringify(tree)).not.toContain("not shown");
    const fields = JSON.stringify(form);
    expect(fields).toContain('"name":"name","label":"Your name"');
    expect(fields).toContain('"name":"text","label":"Report & notes"');
    expect(fields).toContain('"label":"Tag"');
  });

  it("resolves links and form actions against the public origin behind a proxy", async () => {
    // A proxy terminated TLS: the server sees http://, but the shell can only post to https://.
    const loaded: string[] = [];
    const response = await createFarmNativeTreeResponse({
      request: new Request("http://10.0.0.5:3000/notes?tab=all", {
        headers: { accept: "application/vnd.farm.native+json" },
      }),
      origin: "https://notes.example.com",
      renderPage: (request) => {
        loaded.push(request.url);
        if (request.url.endsWith(".css")) {
          return new Response("p { color: red }", { headers: { "content-type": "text/css" } });
        }
        return new Response(
          page(
            '<a href="/notes/1">One</a><form method="post" action="/api/notes"><button>Add</button></form>',
            '<title>Notes</title><link rel="stylesheet" href="/app.css">',
          ),
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    const tree = await response.json();
    expect(tree.unsupported).toEqual([]);
    const json = JSON.stringify(tree);
    expect(json).toContain('"href":"https://notes.example.com/notes/1"');
    expect(json).toContain('"action":"https://notes.example.com/api/notes"');
    expect(json).not.toContain("http://10.0.0.5");
    // The page and its stylesheet still load from this server, as requested.
    expect(loaded).toEqual(["http://10.0.0.5:3000/notes?tab=all", "http://10.0.0.5:3000/app.css"]);
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
