// @vitest-environment node

import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config";
import {
  applyMarkdownNegotiationHeaders,
  createMarkdownMirrorResponse,
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
    // Rows stay separate paragraphs; a single newline would render as one line.
    expect(table).toBe("Target Status\n\nnode ready\n");
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
