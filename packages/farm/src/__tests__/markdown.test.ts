// @vitest-environment node

import React, { createElement, Suspense } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config";
import {
  applyMarkdownNegotiationHeaders,
  createMarkdownMirrorResponse,
  getFarmMarkdownAlternatePath,
  htmlToMarkdown,
  resolveMarkdownConfig,
  resolveMarkdownMirrorTarget,
} from "../markdown";

describe("resolveMarkdownConfig", () => {
  it("exposes markdown mirrors automatically by default", () => {
    expect(resolveMarkdownConfig(undefined)).toMatchObject({
      enabled: true,
      expose: true,
      cache: false,
      includeMetadata: true,
    });
  });

  it("allows automatic markdown mirrors to be disabled", () => {
    expect(resolveMarkdownConfig(false)).toMatchObject({
      enabled: false,
      expose: [],
    });
  });

  it("normalizes exposed routes and aliases routes to expose", () => {
    const config = resolveMarkdownConfig({
      routes: ["/pricing.md", { route: "blog/[slug]", title: "Blog", cache: 60 }],
      cache: 30,
    });

    expect(config).toMatchObject({
      enabled: true,
      expose: [{ route: "/pricing" }, { route: "/blog/[slug]", title: "Blog", cache: 60 }],
      cache: 30,
    });
  });

  it("supports exposing every existing page route", () => {
    expect(resolveMarkdownConfig(true)).toMatchObject({
      enabled: true,
      expose: true,
    });
  });

  it("keeps automatic exposure when only mirror options are configured", () => {
    expect(
      resolveMarkdownConfig({
        cache: 60,
      }),
    ).toMatchObject({
      enabled: true,
      expose: true,
      cache: 60,
    });
  });
});

describe("resolveMarkdownMirrorTarget", () => {
  it("maps exposed .md URLs back to their page route", () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing", "/blog/[slug]"],
    });

    expect(resolveMarkdownMirrorTarget(config, "/pricing.md")).toMatchObject({
      pathname: "/pricing",
      route: { route: "/pricing" },
    });
    expect(resolveMarkdownMirrorTarget(config, "/blog/farm.md")).toMatchObject({
      pathname: "/blog/farm",
      route: { route: "/blog/[slug]" },
    });
  });

  it("maps the root markdown alias to the index page", () => {
    const config = resolveMarkdownConfig({
      expose: ["/"],
    });

    expect(resolveMarkdownMirrorTarget(config, "/index.md")).toMatchObject({
      pathname: "/",
      route: { route: "/" },
    });
  });

  it("negotiates markdown for an exposed page through the Accept header", () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing"],
    });

    expect(
      resolveMarkdownMirrorTarget(config, "/pricing", {
        accept: "text/markdown",
      }),
    ).toMatchObject({
      pathname: "/pricing",
      route: { route: "/pricing" },
    });
    expect(
      resolveMarkdownMirrorTarget(config, "/pricing", {
        accept: "text/markdown; q=0",
      }),
    ).toBeNull();
    expect(
      resolveMarkdownMirrorTarget(config, "/pricing", {
        accept: "text/html",
      }),
    ).toBeNull();
  });

  it("ignores routes that are not exposed", () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing"],
    });

    expect(resolveMarkdownMirrorTarget(config, "/secret.md")).toBeNull();
    expect(resolveMarkdownMirrorTarget(config, "/pricing")).toBeNull();
  });
});

describe("createMarkdownMirrorResponse", () => {
  it("renders an exposed page as markdown", async () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing"],
      cache: 60,
    });

    const response = await createMarkdownMirrorResponse({
      request: new Request("http://farm.test/pricing.md"),
      config,
      routeExists: (pathname) => pathname === "/pricing",
      renderPage: () =>
        new Response(
          [
            "<!doctype html>",
            "<html>",
            "<head><title>Pricing</title></head>",
            "<body>",
            '<div id="root">',
            "<main>",
            "<h1>Pricing</h1>",
            "<p>Simple <strong>plans</strong> for builders.</p>",
            '<a href="/signup">Start now</a>',
            "</main>",
            "</div>",
            "</body>",
            "</html>",
          ].join(""),
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
            },
          },
        ),
    });

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/markdown");
    expect(response?.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(response?.headers.get("x-farm-markdown-route")).toBe("/pricing");
    const markdown = await response?.text();
    expect(markdown).toContain("# Pricing");
    expect(markdown).toContain("**plans**");
  });

  it("returns markdown for content-negotiated page requests", async () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing"],
    });

    const response = await createMarkdownMirrorResponse({
      request: new Request("http://farm.test/pricing", {
        headers: {
          Accept: "text/html, text/markdown;q=0.9",
        },
      }),
      config,
      routeExists: (pathname) => pathname === "/pricing",
      renderPage: (request) => {
        expect(request.headers.get("accept")).toBe("text/html");
        return new Response("<html><body><main><h1>Pricing</h1></main></body></html>", {
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        });
      },
    });

    expect(response?.headers.get("content-type")).toContain("text/markdown");
    expect(response?.headers.get("content-location")).toBe("/pricing.md");
    expect(response?.headers.get("vary")).toBe("Accept");
    await expect(response?.text()).resolves.toContain("# Pricing");
  });

  it("keeps a private page private and varies on what the page varies on", async () => {
    const config = resolveMarkdownConfig({ expose: ["/account"], cache: 60 });
    const renderPage = () =>
      new Response("<html><body><main><h1>Account</h1></main></body></html>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "private, no-store",
          vary: "Cookie, Accept",
        },
      });

    const negotiated = await createMarkdownMirrorResponse({
      request: new Request("http://farm.test/account", {
        headers: { Accept: "text/markdown", Cookie: "session=a" },
      }),
      config,
      routeExists: () => true,
      renderPage,
    });
    expect(negotiated?.headers.get("cache-control")).toBe("private, no-store");
    expect(negotiated?.headers.get("vary")).toBe("Accept, Cookie");

    const explicit = await createMarkdownMirrorResponse({
      request: new Request("http://farm.test/account.md", { headers: { Cookie: "session=a" } }),
      config,
      routeExists: () => true,
      renderPage,
    });
    expect(explicit?.headers.get("cache-control")).toBe("private, no-store");
    expect(explicit?.headers.get("vary")).toBe("Cookie");
  });

  it("returns null when the target page route does not exist", async () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing"],
    });

    const response = await createMarkdownMirrorResponse({
      request: new Request("http://farm.test/pricing.md"),
      config,
      routeExists: () => false,
      renderPage: () => {
        throw new Error("renderPage should not be called");
      },
    });

    expect(response).toBeNull();
  });

  it("supports HEAD requests without a response body", async () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing"],
    });

    const response = await createMarkdownMirrorResponse({
      request: new Request("http://farm.test/pricing.md", { method: "HEAD" }),
      config,
      routeExists: () => true,
      renderPage: () =>
        new Response("<html><body><h1>Pricing</h1></body></html>", {
          headers: {
            "content-type": "text/html",
          },
        }),
    });

    expect(response?.headers.get("content-type")).toContain("text/markdown");
    await expect(response?.text()).resolves.toBe("");
  });
});

describe("applyMarkdownNegotiationHeaders", () => {
  it("advertises the alternate markdown representation on HTML responses", () => {
    const response = applyMarkdownNegotiationHeaders(
      new Response("<html><body>Farm</body></html>", {
        headers: {
          "content-type": "text/html",
          vary: "Cookie",
        },
      }),
      {
        config: resolveMarkdownConfig({
          expose: ["/"],
        }),
        pathname: "/",
      },
    );

    expect(response.headers.get("vary")).toBe("Cookie, Accept");
    expect(response.headers.get("link")).toContain(
      '</index.md>; rel="alternate"; type="text/markdown"',
    );
  });

  it("does not modify unexposed or non-HTML responses", () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing"],
    });
    const unexposed = new Response("<html><body>Private</body></html>", {
      headers: {
        "content-type": "text/html",
      },
    });
    const json = new Response("{}", {
      headers: {
        "content-type": "application/json",
      },
    });

    expect(
      applyMarkdownNegotiationHeaders(unexposed, {
        config,
        pathname: "/account",
      }),
    ).toBe(unexposed);
    expect(
      applyMarkdownNegotiationHeaders(json, {
        config,
        pathname: "/pricing",
      }),
    ).toBe(json);
  });
});

describe("getFarmMarkdownAlternatePath", () => {
  it("returns the .md URL a page advertises, or null when it has no mirror", () => {
    const everyPage = resolveMarkdownConfig(undefined);
    expect(getFarmMarkdownAlternatePath(everyPage, "/")).toBe("/index.md");
    expect(getFarmMarkdownAlternatePath(everyPage, "/docs/intro/")).toBe("/docs/intro.md");

    const pricingOnly = resolveMarkdownConfig({ expose: ["/pricing"] });
    expect(getFarmMarkdownAlternatePath(pricingOnly, "/pricing")).toBe("/pricing.md");
    expect(getFarmMarkdownAlternatePath(pricingOnly, "/account")).toBeNull();
    expect(getFarmMarkdownAlternatePath(resolveMarkdownConfig(false), "/pricing")).toBeNull();
  });
});

describe("htmlToMarkdown", () => {
  it("converts common page HTML into readable markdown", () => {
    expect(
      htmlToMarkdown(
        [
          "<html><head><title>Guide</title></head><body>",
          "<article>",
          "<h2>Install</h2>",
          "<p>Run <code>pnpm add @farm.js/core</code>.</p>",
          '<p><a href="/docs">Read docs</a></p>',
          "</article>",
          "</body></html>",
        ].join(""),
        { sourcePath: "/guide" },
      ),
    ).toContain("[Read docs](/docs)");
  });

  it("decodes entities once and replaces invalid numeric code points", () => {
    expect(htmlToMarkdown("<p>&amp;lt; stays literal</p>", { includeMetadata: false })).toBe(
      "&lt; stays literal\n",
    );
    expect(htmlToMarkdown("<p>&#x1F680;</p>", { includeMetadata: false })).toBe("🚀\n");
    expect(htmlToMarkdown("<p>&#1114112; &#xD800; &#0;</p>", { includeMetadata: false })).toBe(
      "� � �\n",
    );
  });

  it("keeps form controls and table cells from running together", () => {
    // Reduced from farmjs.dev/telemetry, which rendered "Dashboard tokenOpen dashboard".
    const form = htmlToMarkdown(
      [
        '<main><form method="post">',
        '<label for="token">Dashboard token</label>',
        '<input id="token" type="password" required="">',
        '<button type="submit">Open dashboard</button>',
        "</form></main>",
      ].join(""),
      { includeMetadata: false },
    );
    expect(form).toBe("Dashboard token Open dashboard\n");

    const table = htmlToMarkdown(
      "<main><table><tr><th>Target</th><th>Status</th></tr><tr><td>node</td><td>ready</td></tr></table></main>",
      { includeMetadata: false },
    );
    expect(table).toBe("| Target | Status |\n| --- | --- |\n| node | ready |\n");
  });

  it("renders tables as GFM tables", () => {
    expect(
      htmlToMarkdown(
        [
          "<main><p>Plans</p><table><thead><tr><th>Plan</th><th>Price</th><th>Notes</th></tr></thead>",
          '<tbody><tr><td><a href="/pro">Pro</a></td><td>Q&amp;A | month</td><td><code>a&lt;b</code></td></tr>',
          '<tr><td colspan="2">Enterprise</td><td>Talk<br>to us</td></tr>',
          "<tr><td>Free</td></tr></tbody></table></main>",
        ].join(""),
        { includeMetadata: false },
      ),
    ).toBe(
      [
        "Plans",
        "",
        "| Plan | Price | Notes |",
        "| --- | --- | --- |",
        "| [Pro](/pro) | Q&A \\| month | `a<b` |",
        "| Enterprise | | Talk to us |",
        "| Free | | |",
        "",
      ].join("\n"),
    );
  });

  it("keeps the plain-text fallback for tables with no GFM form", () => {
    // Rows stay separate paragraphs; a single newline would render as one line.
    expect(
      htmlToMarkdown(
        "<main><table><tr><td>outer</td><td><table><tr><td>inner</td></tr></table></td></tr></table></main>",
        { includeMetadata: false },
      ),
    ).toBe("outer\n\ninner\n");
    expect(
      htmlToMarkdown(
        "<main><table><tr><td><pre><code>run()</code></pre></td></tr></table></main>",
        { includeMetadata: false },
      ),
    ).toBe("```\nrun()\n```\n");
  });

  it("quotes a table inside a blockquote", () => {
    expect(
      htmlToMarkdown(
        "<main><blockquote><table><tr><th>A</th></tr><tr><td>1</td></tr></table></blockquote></main>",
        { includeMetadata: false },
      ),
    ).toBe("> | A |\n> | --- |\n> | 1 |\n");
  });

  it("keeps the language of a highlighted code block", () => {
    const convert = (html: string) =>
      htmlToMarkdown(`<main>${html}</main>`, { includeMetadata: false });
    expect(convert('<pre><code class="hljs language-ts">let a = 1;</code></pre>')).toBe(
      "```ts\nlet a = 1;\n```\n",
    );
    expect(
      convert('<pre class="shiki" data-language="tsx"><code><span>x</span></code></pre>'),
    ).toBe("```tsx\nx\n```\n");
    expect(convert('<pre class="lang-bash">pnpm dev</pre>')).toBe("```bash\npnpm dev\n```\n");
    // An info string that could break out of the fence line is dropped.
    expect(convert('<pre><code data-language="ts\nx">y</code></pre>')).toBe("```\ny\n```\n");
  });

  it("numbers ordered list items", () => {
    const convert = (html: string) =>
      htmlToMarkdown(`<main>${html}</main>`, { includeMetadata: false });
    expect(convert("<ol><li>Install</li><li>Run <code>farm dev</code></li></ol>")).toBe(
      "1. Install\n2. Run `farm dev`\n",
    );
    expect(convert('<ol start="3"><li>Deploy</li></ol><ul><li>Note</li></ul>')).toBe(
      "3. Deploy\n\n- Note\n",
    );
    // A nested list keeps the bullet fallback rather than mixing up the numbering.
    expect(convert("<ol><li>One<ul><li>a</li></ul></li></ol>")).toContain("- ");
  });

  it("keeps indentation inside code blocks while tidying spacing around them", () => {
    expect(
      htmlToMarkdown(
        "<main><pre><code>if (ok) {\n    run();\n}</code></pre><button>Copy</button></main>",
        {
          includeMetadata: false,
        },
      ),
    ).toBe("```\nif (ok) {\n    run();\n}\n```\n\nCopy\n");
  });

  it("keeps fenced lines inside code from leaking out of the block", () => {
    // Docs that show fenced code put ``` lines inside a code block. They must stay
    // inside it, and the text after the block must still be tidied.
    expect(
      htmlToMarkdown(
        "<main><pre><code>```js\ncode();\n```</code></pre><p>    indented   body text</p></main>",
        { includeMetadata: false },
      ),
    ).toBe("````\n```js\ncode();\n```\n````\n\nindented body text\n");
    expect(
      htmlToMarkdown("<main><pre><code>```\ncode();</code></pre>    indented   body text</main>", {
        includeMetadata: false,
      }),
    ).toBe("````\n```\ncode();\n````\n\nindented body text\n");
  });

  it("sizes the fence of a huge code block without overflowing", () => {
    // Spreading every backtick run into Math.max exceeds the engine's argument limit.
    const code = "`a ".repeat(300_000);
    expect(
      htmlToMarkdown(`<main><pre><code>${code}</code></pre></main>`, {
        includeMetadata: false,
      }).split("\n", 1)[0],
    ).toBe("```");
  });

  it("keeps code blocks inside blockquotes, quoting every line", () => {
    expect(
      htmlToMarkdown(
        "<main><blockquote><p>Run this:</p><pre><code>pnpm install\n\npnpm dev</code></pre></blockquote></main>",
        { includeMetadata: false },
      ),
    ).toBe("> Run this:\n> ```\n> pnpm install\n>\n> pnpm dev\n> ```\n");
  });

  it("leaves out what is hidden from assistive technology", () => {
    const markdown = (html: string) =>
      htmlToMarkdown(`<main>${html}</main>`, { includeMetadata: false });

    expect(markdown('<p>Build<span aria-hidden="true"> / </span>Ship</p>')).toBe("BuildShip\n");
    // A marquee's duplicated copy, nested elements of the same name included.
    expect(
      markdown(
        '<div>React Vite</div><div aria-hidden="true"><div>React</div> Vite</div><p>After</p>',
      ),
    ).toBe("React Vite\n\nAfter\n");
    expect(markdown('<svg ARIA-HIDDEN="TRUE"><path d="M0"/><title>Icon</title></svg>Label')).toBe(
      "Label\n",
    );
    expect(markdown('<p>Shown</p><div hidden>Hidden</div><input hidden value="x"><p>End</p>')).toBe(
      "Shown\n\nEnd\n",
    );
    // `<b>` closes at `</b>`, not at the `<br>` after it.
    expect(markdown('<p><b aria-hidden="true">x</b><br>kept</p>')).toBe("kept\n");
  });

  it("leaves out hidden page wrappers and reads tags whole when finding the hidden end", () => {
    const markdown = (html: string) => htmlToMarkdown(html, { includeMetadata: false });

    // The wrapper's own attribute counts, though extraction drops the wrapper tag.
    expect(markdown('<body><main aria-hidden="true"><p>Decor</p></main><p>Kept</p></body>')).toBe(
      "Kept\n",
    );
    // A slash ending an unquoted value does not make the element self-closing.
    expect(
      markdown(
        '<main><p><a aria-hidden="true" href=/docs/>Skip</a><a href="/x">Kept</a></p></main>',
      ),
    ).toBe("[Kept](/x)\n");
    expect(
      markdown('<main><div aria-hidden="true"><div class=x/>a</div>b</div><p>Kept</p></main>'),
    ).toBe("Kept\n");
    // A closing tag written inside an attribute value does not end the element.
    expect(
      markdown(
        '<main><div aria-hidden="true"><span title="</div>">x</span>secret</div><p>Kept</p></main>',
      ),
    ).toBe("Kept\n");
    // A hidden-looking string inside a script never removes page content.
    expect(
      markdown('<main><script>const t = "<div hidden>";</script><div><p>Kept</p></div></main>'),
    ).toBe("Kept\n");
  });

  it("reads streamed Suspense content in place of its fallback", async () => {
    const resolved = new Set<string>();
    function Slow({ id, ms, children }: { id: string; ms: number; children: React.ReactNode }) {
      if (!resolved.has(id)) {
        throw new Promise<void>((resolve) =>
          setTimeout(() => {
            resolved.add(id);
            resolve();
          }, ms),
        );
      }
      return createElement("section", null, children);
    }
    const page = createElement(
      "html",
      null,
      createElement(
        "body",
        null,
        createElement(
          "main",
          null,
          createElement("h1", null, "Title"),
          createElement(
            Suspense,
            { fallback: createElement("p", null, "Loading outer...") },
            createElement(
              Slow,
              { id: "outer", ms: 5 },
              createElement("p", null, "Outer content"),
              createElement(
                Suspense,
                { fallback: createElement("p", null, "Loading inner...") },
                createElement(Slow, { id: "inner", ms: 30 }, createElement("p", null, "Inner")),
              ),
            ),
          ),
          createElement("p", null, "After"),
        ),
      ),
    );
    const html = await new Response(await renderToReadableStream(page)).text();
    expect(html).toContain('<div hidden id="S:');

    expect(htmlToMarkdown(html, { includeMetadata: false })).toBe(
      "# Title\n\nOuter content\n\nInner\n\nAfter\n",
    );
  });

  it("pairs streamed segments by React's instructions, not by matching numbers", () => {
    const html =
      '<main><!--$?--><template id="B:0"></template><p>Loading</p><!--/$--><p>Tail</p></main>' +
      '<div hidden id="S:0"><p>Wrong segment</p></div>' +
      '<div hidden id="S:1"><p>Ready <template id="P:2"></template></p></div>' +
      '<div hidden id="S:2">now</div>' +
      '<script>$RS("S:2","P:2")</script><script>$RC("B:0","S:1")</script>';

    expect(htmlToMarkdown(html, { includeMetadata: false })).toBe("Ready now\n\nTail\n");
    // Without an instruction, the fallback stays and hidden segments stay out.
    expect(
      htmlToMarkdown(html.replace(/<script>[^<]*<\/script>/g, ""), { includeMetadata: false }),
    ).toBe("Loading\n\nTail\n");
  });

  it("removes many hidden elements in work that grows linearly with the page", () => {
    const regexpExec = RegExp.prototype.exec;
    const countExecs = (count: number) => {
      const html = `<main>${Array.from({ length: count }, (_, index) => `<div hidden><p>v${index}</p>`).join("")}</main>`;
      let calls = 0;
      RegExp.prototype.exec = function (this: RegExp, input: string) {
        calls += 1;
        return regexpExec.call(this, input);
      };
      try {
        htmlToMarkdown(html, { includeMetadata: false });
      } finally {
        RegExp.prototype.exec = regexpExec;
      }
      return calls;
    };

    const small = countExecs(500);
    const large = countExecs(2000);
    // Four times the elements: about four times the regex steps, not sixteen.
    expect(large / small).toBeLessThan(5);
  });

  it("keeps content that is only described as hidden, or can be revealed", () => {
    const markdown = (html: string) =>
      htmlToMarkdown(`<main>${html}</main>`, { includeMetadata: false });

    expect(markdown('<p title="a hidden gem" data-x=\'aria-hidden="true"\'>Visible</p>')).toBe(
      "Visible\n",
    );
    expect(markdown('<p aria-hidden="false">Read me</p>')).toBe("Read me\n");
    expect(markdown('<div hidden="until-found">Findable</div>')).toBe("Findable\n");
    // Unclosed, the element is kept rather than taking the rest of the page.
    expect(markdown('<div aria-hidden="true">Unclosed<p>Rest</p>')).toBe("Unclosed\n\nRest\n");
  });

  it("decodes text outside paragraphs, such as in a div or span", () => {
    expect(
      htmlToMarkdown("<main><div>Tom &amp; Jerry&#x27;s</div></main>", { includeMetadata: false }),
    ).toBe("Tom & Jerry's\n");
  });

  it("keeps escaped tags in text as text", () => {
    const markdown = (html: string) => htmlToMarkdown(html, { includeMetadata: false });

    expect(markdown("<main><p>Use &lt;div&gt; here</p></main>")).toBe("Use <div> here\n");
    expect(markdown("<main><li>Wrap it in &lt;main&gt;</li></main>")).toBe("- Wrap it in <main>\n");
    expect(markdown("<main><p>Run <code>&lt;section&gt;</code></p></main>")).toBe(
      "Run `<section>`\n",
    );
    expect(
      markdown(
        "<main><blockquote><p>a &amp;lt; b &lt;br&gt;</p><pre><code>&lt;div&gt;hi&lt;/div&gt;</code></pre></blockquote></main>",
      ),
    ).toBe("> a &lt; b <br>\n> ```\n> <div>hi</div>\n> ```\n");
  });

  it("does not split words that are only wrapped in inline elements", () => {
    // Letter- and word-split animations wrap one word in sibling spans; without
    // layout information they must read as the source text, not "Hel lo".
    expect(
      htmlToMarkdown("<p><span>Hel</span><span>lo</span> ex<strong>am</strong>ple</p>", {
        includeMetadata: false,
      }),
    ).toBe("Hello ex**am**ple\n");
  });

  it("separates items in a layout row that has no text of its own", () => {
    // JSX drops the line breaks between siblings, so a flex row of a label and
    // a value renders as `<span>00</span><span>Basic starter</span>`.
    expect(
      htmlToMarkdown(
        '<main><div class="eyebrow"><span>00</span><span>FARMJS / Basic starter</span></div>' +
          '<div class="command"><span>01</span><code>npm run dev</code></div>' +
          '<nav><span><a href="/docs"><span>Docs</span></a></span>' +
          '<span><span aria-hidden="true">/</span><a href="/gh"><span>GitHub</span></a></span></nav></main>',
        { includeMetadata: false },
      ),
    ).toBe("00 FARMJS / Basic starter\n\n01 npm run dev\n\nDocs GitHub\n");
  });

  it("keeps a letter-split word joined in a layout container", () => {
    expect(
      htmlToMarkdown(
        "<main><div><span>a</span><span>g</span><span>e</span><span>n</span><span>t</span><span>s</span></div></main>",
        { includeMetadata: false },
      ),
    ).toBe("agents\n");
    // Text of the container's own means it is prose, not a row of items.
    expect(
      htmlToMarkdown("<main><div>ex<span>am</span><span>ple</span></div></main>", {
        includeMetadata: false,
      }),
    ).toBe("example\n");
  });

  it("prefers page content over layout chrome", () => {
    expect(
      htmlToMarkdown(
        [
          "<html><body>",
          '<div id="root">',
          "<nav>Home About Contact</nav>",
          "<main><h1>About</h1><p>Readable page content.</p></main>",
          "</div>",
          "</body></html>",
        ].join(""),
      ),
    ).not.toContain("Home About Contact");
  });
});

describe("resolveConfig markdown mirrors", () => {
  it("resolves md config from farm.config options", async () => {
    const config = await resolveConfig(
      {
        md: {
          expose: ["/pricing"],
          cache: 60,
        },
      },
      "development",
    );

    expect(config.md).toMatchObject({
      enabled: true,
      expose: [{ route: "/pricing" }],
      cache: 60,
    });
  });
});

describe("htmlToMarkdown images", () => {
  const convert = (body: string) =>
    htmlToMarkdown(`<html><body><main>${body}</main></body></html>`, { includeMetadata: false });

  it("keeps images whatever order alt and src come in", () => {
    // Farm's <Image> renders alt before src.
    expect(convert('<p><img alt="Revenue chart" src="/chart.png" width="640"></p>')).toBe(
      "![Revenue chart](/chart.png)\n",
    );
    expect(convert("<p><img src='/logo.svg' alt='Farm logo' /></p>")).toBe(
      "![Farm logo](/logo.svg)\n",
    );
  });

  it("keeps an image without alt text and ignores srcset and data-src", () => {
    expect(
      convert('<p><img data-src="/lazy.png" srcset="/a.png 1x, /b.png 2x" src="/photo.jpg"></p>'),
    ).toBe("![](/photo.jpg)\n");
  });

  it("keeps only the description of an inline data URL", () => {
    expect(
      convert('<p>Before <img alt="Placeholder" src="data:image/png;base64,AAAA"> after</p>'),
    ).toBe("Before Placeholder after\n");
  });
});

describe("Markdown mirror indexing headers", () => {
  const mirror = (head: string, pageHeaders: Record<string, string> = {}) =>
    createMarkdownMirrorResponse({
      request: new Request("https://acme.test/drafts.md"),
      config: resolveMarkdownConfig({ expose: ["/drafts"] }),
      renderPage: async () =>
        new Response(`<html><head>${head}</head><body><main><p>Draft</p></main></body></html>`, {
          headers: { "Content-Type": "text/html; charset=utf-8", ...pageHeaders },
        }),
    });

  it("keeps the page's robots rules and points at its canonical URL", async () => {
    const response = await mirror(
      '<meta content="noindex, nofollow" name="robots"><link href="/drafts" rel="canonical">',
      { "X-Robots-Tag": "noarchive" },
    );
    expect(response?.headers.get("x-robots-tag")).toBe("noarchive, noindex, nofollow");
    expect(response?.headers.get("link")).toBe('<https://acme.test/drafts>; rel="canonical"');
  });

  it("adds neither header for a page without robots rules or a canonical link", async () => {
    const response = await mirror("<title>Drafts</title>");
    expect(response?.headers.get("x-robots-tag")).toBeNull();
    expect(response?.headers.get("link")).toBeNull();
  });
});

describe("htmlToMarkdown page content", () => {
  it("keeps every item of an index page that has several articles and no main", () => {
    const markdown = htmlToMarkdown(
      "<html><body><h1>Blog</h1><p>Latest posts.</p><article><h2>First</h2><p>One</p></article><article><h2>Second</h2><p>Two</p></article></body></html>",
      { includeMetadata: false },
    );
    expect(markdown).toBe("# Blog\n\nLatest posts.\n\n## First\n\nOne\n\n## Second\n\nTwo\n");
  });

  it("still reads a single article as the page content", () => {
    expect(
      htmlToMarkdown(
        "<html><body><nav><a href='/'>Home</a></nav><article><h1>Post</h1><p>Body.</p></article></body></html>",
        { includeMetadata: false },
      ),
    ).toBe("# Post\n\nBody.\n");
  });
});

describe("Markdown mirrors of protected pages", () => {
  const mirror = (page: Response, method = "GET") =>
    createMarkdownMirrorResponse({
      request: new Request("https://acme.test/account.md", { method }),
      config: resolveMarkdownConfig({ expose: ["/account"] }),
      renderPage: async () => page,
    });

  it("answers a sign-in redirect with the same status and a Markdown link", async () => {
    const response = await mirror(
      new Response(null, { status: 307, headers: { Location: "/login?next=%2Faccount" } }),
    );
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("/login?next=%2Faccount");
    expect(response?.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(await response?.text()).toBe(
      "# Redirected\n\n`/account` redirects to [https://acme.test/login?next=%2Faccount](https://acme.test/login?next=%2Faccount). The page may require signing in.\n",
    );
  });

  it("answers a redirect that carries an HTML body with the redirect", async () => {
    const response = await mirror(
      new Response("<html><body>Redirecting</body></html>", {
        status: 307,
        headers: { Location: "/login", "Content-Type": "text/html; charset=utf-8" },
      }),
    );
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("/login");
    expect(await response?.text()).toContain("redirects to [https://acme.test/login]");
  });

  it("explains 401 and 403 without a page body", async () => {
    const unauthorized = await mirror(
      new Response(null, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="acme"' } }),
    );
    expect(unauthorized?.status).toBe(401);
    expect(unauthorized?.headers.get("www-authenticate")).toBe('Bearer realm="acme"');
    expect(await unauthorized?.text()).toBe(
      "# Sign-in required\n\n`/account` requires signing in.\n",
    );

    const forbidden = await mirror(new Response(null, { status: 403 }));
    expect(forbidden?.status).toBe(403);
    expect(await forbidden?.text()).toContain("# Access denied");
  });

  it("keeps HEAD bodiless and leaves other non-HTML responses alone", async () => {
    const head = await mirror(
      new Response(null, { status: 302, headers: { Location: "/login" } }),
      "HEAD",
    );
    expect(head?.status).toBe(302);
    expect(await head?.text()).toBe("");
    const failure = new Response("oops", { status: 500 });
    expect(await mirror(failure)).toBe(failure);
    expect(await failure.text()).toBe("oops");
  });
});
