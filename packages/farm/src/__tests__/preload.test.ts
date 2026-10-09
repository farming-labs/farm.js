// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearReportedFarmPreloadWarnings,
  manageFarmDocumentPreloads,
  manageFarmHtmlPreloads,
  manageFarmLinkHeaderPreloads,
  reportFarmPreloadWarnings,
  resolveFarmPerformanceConfig,
} from "../preload";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("smart preload manager", () => {
  it.each(["script", "style", "template", "textarea", "title", "noscript", "svg"])(
    "preserves Unicode offsets around inert %s contents in both budget modes",
    (tag) => {
      const inertHint = '<link rel="preload" as="image" href="/inert.webp">';
      const liveHint = '<LINK REL="preload" AS="image" HREF="/live.webp">';
      for (const mode of ["enforce", "warn"] as const) {
        const config = resolveFarmPerformanceConfig({ preload: { mode, maxImages: 0 } }).preload;
        for (const [prefix, content] of [
          ["İstanbul", ""],
          ["", "İİİİİİİİ"],
          ["İ", "İ"],
        ]) {
          const inert = `${prefix}<${tag.toUpperCase()} data-note=">">${content}${inertHint}</${tag}>`;
          const html = inert + liveHint;
          const warnings = [
            { kind: "image", count: 1, budget: 0, removed: mode === "enforce" ? 1 : 0 },
          ];
          expect(manageFarmDocumentPreloads(html, "", config)).toEqual({
            html: mode === "enforce" ? inert : html,
            linkHeader: "",
            warnings,
          });
          expect(manageFarmHtmlPreloads(html, config)).toEqual({
            value: mode === "enforce" ? inert : html,
            warnings,
          });
        }
      }
    },
  );

  it("does not rewrite JavaScript strings after length-expanding Unicode", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 0 } }).preload;
    const html = 'İ<script>const hint="<link rel=preload as=image href=/fake.webp>";</script>';
    expect(manageFarmDocumentPreloads(html, "", config)).toEqual({
      html,
      linkHeader: "",
      warnings: [],
    });
  });

  it("preserves Unicode in quoted opening attributes and spaced closing tags", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 0 } }).preload;
    const hint = '<link rel="preload" as="image" href="/image.webp">';
    const inert = `<SCRIPT data-note="İ>">${hint}</SCRIPT >`;
    expect(manageFarmHtmlPreloads(inert + hint, config)).toEqual({
      value: inert,
      warnings: [{ kind: "image", count: 1, budget: 0, removed: 1 }],
    });
  });

  it("does not normalize Unicode HTML without preload candidates", () => {
    const config = resolveFarmPerformanceConfig(undefined).preload;
    const html = "<main>İstanbul</main>";
    const lowercase = vi.spyOn(String.prototype, "toLowerCase");
    expect(manageFarmDocumentPreloads(html, "", config)).toEqual({
      html,
      linkHeader: "",
      warnings: [],
    });
    expect(lowercase.mock.contexts).not.toContain(html);
  });

  it.each(["enforce", "warn"] as const)(
    "preserves Unicode comments, unclosed raw text and close-tag lookalikes in %s mode",
    (mode) => {
      const config = resolveFarmPerformanceConfig({ preload: { mode, maxImages: 0 } }).preload;
      const hint = '<link rel="preload" as="image" href="/fake.webp">';
      for (const html of [
        `İ<!-- ${hint} -->`,
        `<!-- İ ${hint} -->`,
        `İ<!-- ${hint}`,
        `İ<script>${hint}`,
        `<script>İ${hint}`,
        `İ<ScRiPt>${hint}</scriptx>${hint}</ScRiPt>`,
        `İ<div data-note='${hint}'>keep</div>`,
      ]) {
        expect(manageFarmDocumentPreloads(html, "", config)).toEqual({
          html,
          linkHeader: "",
          warnings: [],
        });
      }
    },
  );

  it("retains Link-header budgeting and real hints after a Unicode self-closing SVG", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 0, maxFonts: 0 } }).preload;
    const hint = '<link rel="preload" as="image" href="/real.webp">';
    expect(
      manageFarmDocumentPreloads(`İ<SVG/>${hint}`, "</font.woff2>; rel=preload; as=font", config),
    ).toEqual({
      html: "İ<SVG/>",
      linkHeader: "",
      warnings: [
        { kind: "image", count: 1, budget: 0, removed: 1 },
        { kind: "font", count: 1, budget: 0, removed: 1 },
      ],
    });
  });

  it("recognizes tags without slicing the remaining document at every tag", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 0 } }).preload;
    const hint = '<link rel="preload" as="image" href="/hero.webp">';
    const content = "<article><p>keep</p></article>".repeat(120);
    const html = content + hint;
    const slice = vi.spyOn(String.prototype, "slice");
    const result = manageFarmDocumentPreloads(html, "", config);
    const suffixSlices = slice.mock.calls.filter(
      (args, index) => slice.mock.contexts[index] === html && args[1] === undefined,
    );
    slice.mockRestore();

    expect(result).toEqual({
      html: content,
      linkHeader: "",
      warnings: [{ kind: "image", count: 1, budget: 0, removed: 1 }],
    });
    // The final output tail is allowed; tag recognition must not slice suffixes.
    expect(suffixSlices).toHaveLength(1);
  });

  it.each(["enforce", "warn"] as const)(
    "keeps tag recognition anchored and resets matcher state between %s documents",
    (mode) => {
      const config = resolveFarmPerformanceConfig({ preload: { mode, maxImages: 0 } }).preload;
      const hint = '<LiNk rel="preload" as="image" href="/hero.webp">';
      const inert =
        `<!-- ${hint} -->` +
        `<ScRiPt data-note=">">${hint}</ScRiPt>` +
        `<textarea>${hint}</textarea>` +
        `<section data-note='${hint}'>keep</section>`;
      for (const prefix of ["<", "<!invalid>", "<123>", "plain text", ""]) {
        for (const [html, withoutHint] of [
          [prefix + hint + inert, prefix + inert],
          [inert + hint, inert],
          [hint, ""],
        ]) {
          expect(manageFarmDocumentPreloads(html, "", config)).toEqual({
            html: mode === "warn" ? html : withoutHint,
            linkHeader: "",
            warnings: [{ kind: "image", count: 1, budget: 0, removed: mode === "warn" ? 0 : 1 }],
          });
        }
      }
    },
  );

  it.each([null, undefined, 42, {}])("preserves the runtime error for invalid HTML %j", (html) => {
    const config = resolveFarmPerformanceConfig(undefined).preload;
    expect(() => manageFarmHtmlPreloads(html as unknown as string, config)).toThrow(TypeError);
    expect(() => manageFarmDocumentPreloads(html as unknown as string, "", config)).toThrow(
      TypeError,
    );
  });

  it.each(["enforce", "warn"] as const)(
    "avoids full-document normalization without preload candidates in %s mode",
    (mode) => {
      const config = resolveFarmPerformanceConfig({ preload: { mode } }).preload;
      const html = [
        '<!doctype html><html><head><link rel="stylesheet" href="/app.css">',
        '<link rel="MODULEPRELOAD" href="/app.js"></head><body>',
        '<p data-state="preloading">ordinary content</p>'.repeat(120),
        "</body></html>",
      ].join("");
      const lowercase = vi.spyOn(String.prototype, "toLowerCase");

      const htmlResult = manageFarmHtmlPreloads(html, config);
      const documentResult = manageFarmDocumentPreloads(html, "", config);
      const normalizedDocument = lowercase.mock.contexts.some((value) => value === html);
      lowercase.mockRestore();

      // Assert avoided work, not a machine-dependent timing threshold.
      expect(normalizedDocument).toBe(false);
      expect(htmlResult).toEqual({ value: html, warnings: [] });
      expect(documentResult).toEqual({ html, linkHeader: "", warnings: [] });
    },
  );

  it.each(["enforce", "warn"] as const)(
    "still budgets Link headers when HTML has no candidates in %s mode",
    (mode) => {
      const config = resolveFarmPerformanceConfig({
        preload: { mode, maxImages: 1, maxFonts: 1 },
      }).preload;
      const html = '<link rel="modulepreload" href="/app.js"><main>no hints</main>';
      const links = [
        "</below.webp>; rel=preload; as=image",
        "</hero.webp>; rel=preload; as=image; fetchpriority=high",
        "</body.woff2>; rel=preload; as=font",
        "</mono.woff2>; rel=preload; as=font",
        "<https://api.example.test>; rel=preconnect",
      ];
      const linkHeader = links.join(", ");
      expect(manageFarmDocumentPreloads(html, linkHeader, config)).toEqual({
        html,
        linkHeader: mode === "warn" ? linkHeader : [links[1], links[2], links[4]].join(", "),
        warnings: [
          { kind: "image", count: 2, budget: 1, removed: mode === "warn" ? 0 : 1 },
          { kind: "font", count: 2, budget: 1, removed: mode === "warn" ? 0 : 1 },
        ],
      });
    },
  );

  it.each(["PRELOAD", "alternate\tpreload", "preload\nalternate", "alternate\u00a0pReLoAd"])(
    "retains the parser for the preload relation %j",
    (rel) => {
      const config = resolveFarmPerformanceConfig({
        preload: { maxImages: 0 },
      }).preload;
      const html = `<LINK\nREL="${rel}" AS='IMAGE' HREF=/hero.webp><main>keep</main>`;
      const result = manageFarmDocumentPreloads(html, "", config);
      expect(result).toEqual({
        html: "<main>keep</main>",
        linkHeader: "",
        warnings: [{ kind: "image", count: 1, budget: 0, removed: 1 }],
      });
    },
  );

  it("does not mistake preload-looking content for budgeted links", () => {
    const config = resolveFarmPerformanceConfig({
      preload: { maxImages: 0, maxFonts: 0 },
    }).preload;
    const html = [
      "<p>preload image</p>",
      '<link rel="modulepreload" href="/preload.js">',
      '<!-- <link rel="preload" as="image" href="/comment.webp"> -->',
      '<script>"<link rel=preload as=image href=/script.webp>"</script>',
      `<div data-note='<link rel="preload" as="font" href="/font.woff2">'>keep</div>`,
    ].join("");
    expect(manageFarmDocumentPreloads(html, "", config)).toEqual({
      html,
      linkHeader: "",
      warnings: [],
    });
  });

  it("defaults to one image and two font preloads in enforce mode", () => {
    expect(resolveFarmPerformanceConfig(undefined)).toEqual({
      preload: { mode: "enforce", maxImages: 1, maxFonts: 2 },
    });
  });

  it("keeps the high-priority LCP image and removes lower-priority image hints", () => {
    const config = resolveFarmPerformanceConfig(undefined).preload;
    const html = [
      '<link rel="preload" as="image" href="/logo.webp">',
      '<link rel="preload" as="image" href="/hero.webp" fetchPriority="High">',
      '<link rel="preload" as="image" href="/below-fold.webp">',
      '<link rel="modulepreload" href="/farm-client.js">',
    ].join("\n");

    const result = manageFarmHtmlPreloads(html, config);

    expect(result.value).toContain("/hero.webp");
    expect(result.value).not.toContain("/logo.webp");
    expect(result.value).not.toContain("/below-fold.webp");
    expect(result.value).toContain('rel="modulepreload"');
    expect(result.warnings).toEqual([{ kind: "image", count: 3, budget: 1, removed: 2 }]);
  });

  it("ignores link-looking text in comments and raw-text elements", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 1 } }).preload;
    const html = [
      '<script>const example = `<link rel="preload" as="image" href="/script.webp">`;</script>',
      '<!-- <link rel="preload" as="image" href="/comment.webp"> -->',
      '<template><link rel="preload" as="image" href="/template.webp"></template>',
      '<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">',
      '<link rel="preload" as="image" href="/below.webp" data-note="1 > 0">',
    ].join("\n");

    const result = manageFarmHtmlPreloads(html, config);

    expect(result.value).toContain("/script.webp");
    expect(result.value).toContain("/comment.webp");
    expect(result.value).toContain("/template.webp");
    expect(result.value).toContain("/hero.webp");
    expect(result.value).not.toContain("/below.webp");
    expect(result.warnings).toEqual([{ kind: "image", count: 2, budget: 1, removed: 1 }]);
  });

  it("only rewrites real HTML link elements outside inert and quoted content", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 1 } }).preload;
    const html = [
      `<div data-example='<link rel="preload" as="image" href="/attribute.webp">'>demo</div>`,
      '<link-card rel="preload" as="image" href="/custom.webp"></link-card>',
      '<title><link rel="preload" as="image" href="/title.webp"></title>',
      '<noscript><link rel="preload" as="image" href="/noscript.webp"></noscript>',
      '<script>const closing = "</scriptx>"; <link rel="preload" as="image" href="/script.webp"></script>',
      '<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">',
      '<link rel="preload" as="image" href="/below.webp">',
    ].join("\n");

    const result = manageFarmHtmlPreloads(html, config);

    expect(result.value).toContain("/attribute.webp");
    expect(result.value).toContain("/custom.webp");
    expect(result.value).toContain("/title.webp");
    expect(result.value).toContain("/noscript.webp");
    expect(result.value).toContain("/script.webp");
    expect(result.value).toContain("/hero.webp");
    expect(result.value).not.toContain("/below.webp");
    expect(result.warnings).toEqual([{ kind: "image", count: 2, budget: 1, removed: 1 }]);
  });

  it("caps font Link headers while preserving non-preload relations", () => {
    const config = resolveFarmPerformanceConfig(undefined).preload;
    const header = [
      "</fonts/body.woff2>; rel=preload; as=font; crossorigin",
      "</fonts/mono.woff2>; rel=preload; as=font; crossorigin",
      "</fonts/display.woff2>; rel=preload; as=font; crossorigin",
      "<https://api.example.test>; rel=preconnect",
    ].join(", ");

    const result = manageFarmLinkHeaderPreloads(header, config);

    expect(result.value).toContain("/fonts/body.woff2");
    expect(result.value).toContain("/fonts/mono.woff2");
    expect(result.value).not.toContain("/fonts/display.woff2");
    expect(result.value).toContain("rel=preconnect");
    expect(result.warnings).toEqual([{ kind: "font", count: 3, budget: 2, removed: 1 }]);
  });

  it("splits Link values with apostrophes in URIs", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxFonts: 1 } }).preload;
    const header = [
      "</fonts/designer's-body.woff2>; rel=preload; as=font",
      "</fonts/mono.woff2>; rel=preload; as=font",
      "<https://api.example.test>; rel=preconnect",
    ].join(", ");

    const result = manageFarmLinkHeaderPreloads(header, config);

    expect(result.value).toContain("designer's-body.woff2");
    expect(result.value).not.toContain("/fonts/mono.woff2");
    expect(result.value).toContain("rel=preconnect");
  });

  it("parses quoted parameters and relation token lists after the URI", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxFonts: 1 } }).preload;
    const header = [
      '</fonts/hero.woff2>; rel="preload alternate"; as="font"; fetchpriority="high"; title="two\\\\"',
      '</fonts/body.woff2>; rel = "preload" ; as = "font"',
      '<https://example.test/?rel=preload&as=font>; rel="next"',
    ].join(", ");

    const result = manageFarmLinkHeaderPreloads(header, config);

    expect(result.value).toContain("hero.woff2");
    expect(result.value).not.toContain("body.woff2");
    expect(result.value).toContain("rel=preload&as=font");
    expect(result.warnings).toEqual([{ kind: "font", count: 2, budget: 1, removed: 1 }]);
  });

  it("shares one budget across HTML and response Link hints", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxFonts: 2 } }).preload;
    const html = [
      '<link rel="preload" as="font" href="/fonts/body.woff2">',
      '<link rel="preload" as="font" href="/fonts/mono.woff2">',
    ].join("");
    const header = "</fonts/display.woff2>; rel=preload; as=font";

    const result = manageFarmDocumentPreloads(html, header, config);

    expect(result.html).toContain("body.woff2");
    expect(result.html).toContain("mono.woff2");
    expect(result.linkHeader).toBe("");
    expect(result.warnings).toEqual([{ kind: "font", count: 3, budget: 2, removed: 1 }]);
  });

  it("supports warning-only mode without changing the document", () => {
    const config = resolveFarmPerformanceConfig({
      preload: { mode: "warn", maxImages: 1 },
    }).preload;
    const html =
      '<link rel="preload" as="image" href="/one.webp"><link rel="preload" as="image" href="/two.webp">';

    expect(manageFarmHtmlPreloads(html, config)).toEqual({
      value: html,
      warnings: [{ kind: "image", count: 2, budget: 1, removed: 0 }],
    });
  });

  it("reports actionable preload budget guidance", () => {
    clearReportedFarmPreloadWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reportFarmPreloadWarnings(
      [{ kind: "image", count: 4, budget: 1, removed: 3 }],
      "route /catalog",
    );

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("route /catalog emitted 4 image preload hints");
    expect(warn.mock.calls[0]?.[0]).toContain("LCP image");

    clearReportedFarmPreloadWarnings();
    reportFarmPreloadWarnings(
      [{ kind: "image", count: 4, budget: 1, removed: 3 }],
      "route /catalog",
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("counts and budgets preloads after a self-closing foreign-content <svg/>", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 1 } }).preload;
    const html = [
      '<svg width="24" height="24"/>',
      '<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">',
      '<link rel="preload" as="image" href="/below.webp">',
    ].join("\n");

    const result = manageFarmDocumentPreloads(html, "", config);

    expect(result.html).toContain("/hero.webp");
    expect(result.html).not.toContain("/below.webp");
    expect(result.linkHeader).toBe("");
    expect(result.warnings).toEqual([{ kind: "image", count: 2, budget: 1, removed: 1 }]);
  });

  it("resumes scanning preloads after a self-closing <svg/> followed by a later <svg>…</svg>", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 1 } }).preload;
    const html = [
      '<svg width="24" height="24"/>',
      '<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">',
      '<link rel="preload" as="image" href="/below.webp">',
      '<svg><path d="M0 0"/></svg>',
      '<link rel="preload" as="image" href="/after.webp">',
    ].join("\n");

    const result = manageFarmDocumentPreloads(html, "", config);

    expect(result.html).toContain("/hero.webp");
    expect(result.html).not.toContain("/below.webp");
    expect(result.html).not.toContain("/after.webp");
    expect(result.warnings).toEqual([{ kind: "image", count: 3, budget: 1, removed: 2 }]);
  });

  it("reports an accurate count when a self-closing <svg/> precedes a later <svg>…</svg> and excess hints", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 1 } }).preload;
    const html = [
      '<svg width="24" height="24"/>',
      '<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">',
      '<link rel="preload" as="image" href="/below.webp">',
      '<svg><path d="M0 0"/></svg>',
      '<link rel="preload" as="image" href="/after1.webp">',
      '<link rel="preload" as="image" href="/after2.webp">',
      '<link rel="preload" as="image" href="/after3.webp">',
    ].join("\n");

    const result = manageFarmDocumentPreloads(html, "", config);

    expect(result.html).toContain("/hero.webp");
    expect(result.html).not.toContain("/below.webp");
    expect(result.html).not.toContain("/after1.webp");
    expect(result.html).not.toContain("/after2.webp");
    expect(result.html).not.toContain("/after3.webp");
    expect(result.warnings).toEqual([{ kind: "image", count: 5, budget: 1, removed: 4 }]);
  });

  it("still treats <script …/> without a closing tag as raw-text that swallows the rest", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 1 } }).preload;
    const html = [
      '<script src="/app.js"/>',
      '<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">',
      '<link rel="preload" as="image" href="/below.webp">',
    ].join("\n");

    const result = manageFarmDocumentPreloads(html, "", config);

    expect(result.html).toBe(html);
    expect(result.warnings).toEqual([]);
  });

  it("keeps preloads inside a properly-closed <svg>…</svg> inert while counting the ones after it", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 1 } }).preload;
    const html = [
      '<svg><link rel="preload" as="image" href="/inside.webp"></svg>',
      '<link rel="preload" as="image" href="/after.webp" fetchpriority="high">',
      '<link rel="preload" as="image" href="/other.webp">',
    ].join("\n");

    const result = manageFarmDocumentPreloads(html, "", config);

    expect(result.html).toContain("/inside.webp");
    expect(result.html).toContain("/after.webp");
    expect(result.html).not.toContain("/other.webp");
    expect(result.warnings).toEqual([{ kind: "image", count: 2, budget: 1, removed: 1 }]);
  });
});
