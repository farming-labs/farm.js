// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDocsConfig } from "../config";
import { createFarmDocsHandler } from "../docs";

describe("createFarmDocsHandler Setext TOC", () => {
  async function createDocsFixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-setext-toc-"));
    const docsDir = path.join(root, "src", "app", "docs");
    const publicDir = path.join(root, "public");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(publicDir, { recursive: true });
    await fs.writeFile(
      path.join(publicDir, "favicon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"></svg>',
    );
    await fs.writeFile(path.join(docsDir, "page.md"), "# Index\n\nIndex page.");
    const docs = await resolveDocsConfig(
      { entry: "/docs", config: { entry: "docs" } },
      { root, srcDir: "src" },
    );
    return { root, docs, docsDir };
  }

  async function renderPage(slug: string, body: string): Promise<string> {
    const { root, docs, docsDir } = await createDocsFixture();
    await fs.mkdir(path.join(docsDir, slug), { recursive: true });
    await fs.writeFile(path.join(docsDir, slug, "page.md"), body);
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });
    const response = await handler(
      new Request(`http://farm.test/docs/${slug}`, { headers: { accept: "text/html" } }),
    );
    expect(response?.status).toBe(200);
    return (await response?.text()) || "";
  }

  function tocSection(html: string): string {
    return html.slice(html.indexOf('id="nd-toc"'));
  }

  it("keeps the on this page TOC anchor in sync when a Setext heading precedes a duplicate ATX heading", async () => {
    const html = await renderPage(
      "collision",
      ["Foo", "===", "", "Intro.", "", "## Foo", "", "Details."].join("\n"),
    );

    // The renderer disambiguates the repeated slug: the Setext h1 -> #foo, the
    // ATX h2 -> #foo-2 (the renderer slugged the Setext heading first).
    expect(html).toContain('id="foo"');
    expect(html).toContain('id="foo-2"');

    // The TOC must link to the h2's real id, not the page-title h1.
    const toc = tocSection(html);
    expect(toc).toContain('href="#foo-2"');
    expect(toc).not.toContain('href="#foo"');
  });

  it("keeps the TOC in sync for a multi-line Setext heading colliding with a later ATX heading", async () => {
    const html = await renderPage(
      "multiline-collision",
      ["Foo", "bar", "===", "", "Intro.", "", "## Foo bar", "", "Details."].join("\n"),
    );

    // The multi-line Setext h1 ("Foo bar") slugs to "foo-bar"; the ATX h2 repeats
    // that base, so the renderer assigns #foo-bar-2.
    expect(html).toContain('id="foo-bar"');
    expect(html).toContain('id="foo-bar-2"');

    const toc = tocSection(html);
    expect(toc).toContain('href="#foo-bar-2"');
    expect(toc).not.toContain('href="#foo-bar"');
  });

  it("links a later ATX heading to its own id when a lone Setext heading uses a distinct slug", async () => {
    const html = await renderPage(
      "lone-distinct",
      ["Title", "===", "", "Intro.", "", "## Section", "", "Text."].join("\n"),
    );

    expect(html).toContain('id="title"');
    expect(html).toContain('id="section"');

    const toc = tocSection(html);
    expect(toc).toContain('href="#section"');
    expect(toc).not.toContain('href="#title"');
    expect(toc).not.toContain('href="#section-2"');
  });

  it("includes a Setext h2 in the TOC and links it to its rendered id", async () => {
    const html = await renderPage(
      "setext-h2",
      ["Section A", "---", "", "Body.", "", "## Section B", "", "More."].join("\n"),
    );

    expect(html).toContain('id="section-a"');
    expect(html).toContain('id="section-b"');

    const toc = tocSection(html);
    expect(toc).toContain('href="#section-a"');
    expect(toc).toContain('href="#section-b"');
  });

  it("treats a `---` after a blank line as a thematic break, not a Setext heading, and keeps the slugger in sync", async () => {
    const html = await renderPage(
      "thematic-break",
      ["Para", "", "---", "", "## Para", "", "End."].join("\n"),
    );

    // The `---` is a thematic break (blank line before it), so marked does not
    // slug it and the ATX h2 is the first (and only) "para" base -> #para.
    expect(html).toContain("<hr");
    expect(html).toContain('id="para"');
    expect(html).not.toContain('id="para-2"');

    const toc = tocSection(html);
    expect(toc).toContain('href="#para"');
    expect(toc).not.toContain('href="#para-2"');
  });

  it("does not form a Setext heading from a lazy continuation of a blockquote (keeps slugger in sync)", async () => {
    const html = await renderPage(
      "blockquote-lazy",
      ["> quote", "Foo", "---", "", "## Foo", "", "End."].join("\n"),
    );

    // `Foo` is a lazy continuation of the blockquote paragraph, so the `---`
    // is not a Setext heading; the renderer only slugs the ATX `## Foo` -> #foo.
    expect(html).toContain('id="foo"');
    expect(html).not.toContain('id="foo-2"');

    const toc = tocSection(html);
    expect(toc).toContain('href="#foo"');
    expect(toc).not.toContain('href="#foo-2"');
  });

  it("does not form a Setext heading from a lazy continuation of a list item (keeps slugger in sync)", async () => {
    const html = await renderPage(
      "list-lazy",
      ["- item", "Foo", "---", "", "## Foo", "", "End."].join("\n"),
    );

    expect(html).toContain('id="foo"');
    expect(html).not.toContain('id="foo-2"');

    const toc = tocSection(html);
    expect(toc).toContain('href="#foo"');
    expect(toc).not.toContain('href="#foo-2"');
  });

  it("does not detect Setext underlines inside a fenced code block as headings", async () => {
    const html = await renderPage(
      "fenced-setext",
      ["```md", "NotAHeading", "===", "```", "", "## Real", "", "Text."].join("\n"),
    );

    // The fenced `NotAHeading\n===` is code, not a heading; the slugger must not
    // advance for it, so the ATX `## Real` keeps the first "real" base -> #real.
    expect(html).toContain('id="real"');
    expect(html).not.toContain('id="notheading"');
    expect(html).not.toContain('id="notaheading"');

    const toc = tocSection(html);
    expect(toc).toContain('href="#real"');
    expect(toc).not.toContain('href="#notheading"');
    expect(toc).not.toContain('href="#notaheading"');
  });
});
