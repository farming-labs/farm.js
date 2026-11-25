// @vitest-environment jsdom

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "leaf";
import { createRoot } from "leaf/dom";
import { renderToReadableStream, renderToString } from "leaf/server";
import { transformWithOxc } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { compileLeaf, LeafCompileError } from "../src/compile.js";

// Each test compiles a .leaf source the way farm-leaf/vite does, imports the module, and compares
// what leaf renders with the same tree written as createElement() calls.

const scratch = mkdtempSync(path.join(path.dirname(fileURLToPath(import.meta.url)), ".compiled-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let modules = 0;
async function load(source) {
  const { code } = await transformWithOxc(compileLeaf(source, "Test", "test.leaf"), "test.tsx", {
    lang: "tsx",
    jsx: { runtime: "automatic", importSource: "leaf" },
  });
  const file = path.join(scratch, `module-${modules++}.mjs`);
  writeFileSync(file, code);
  return (await import(pathToFileURL(file).href)).default;
}

async function render(source, props = {}) {
  return renderToString(createElement(await load(source), props));
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe(".leaf markup", () => {
  it("renders text, {{ values }}, and attributes as the matching JSX does", async () => {
    const html = await render(
      `<script>
  const crop = props.crop;
</script>

<!-- A comment, which renders nothing. -->
<section class="crop" data-name="{{ crop }}" title="Crop: {{ crop }}!">
  <h1 id="title">
    Hello {{ crop }}
  </h1>
  <label for="ripe">Ripe</label>
  <input id="ripe" type="checkbox" checked>
  <p>1 < 2 and {{ 3 }} > 2 } &amp; done</p>
</section>`,
      { crop: "wheat" },
    );
    expect(html).toBe(
      await renderToString(
        createElement(
          "section",
          { className: "crop", "data-name": "wheat", title: "Crop: wheat!" },
          createElement("h1", { id: "title" }, "Hello ", "wheat"),
          createElement("label", { htmlFor: "ripe" }, "Ripe"),
          createElement("input", { id: "ripe", type: "checkbox", checked: true }),
          createElement("p", null, "1 < 2 and ", 3, " > 2 } & done"),
        ),
      ),
    );
  });

  it("renders <leaf:if>, <leaf:else-if>, and <leaf:else>", async () => {
    const source = `<p>
  <leaf:if test="props.count > 3">many</leaf:if>
  <leaf:else-if test="{{ props.count > 0 }}">some</leaf:else-if>
  <leaf:else>none</leaf:else>
</p>
<leaf:if test="props.count === 1"><em>exactly one</em></leaf:if>`;
    expect(await render(source, { count: 5 })).toBe("<p>many</p>");
    expect(await render(source, { count: 1 })).toBe("<p>some</p><em>exactly one</em>");
    expect(await render(source, { count: 0 })).toBe("<p>none</p>");
  });

  it("repeats <leaf:for> for each item, with an optional index", async () => {
    const html = await render(`<script>
  const crops = ["wheat", "barley", "rye"];
</script>
<ul id="crops">
  <leaf:for each="crop" in="crops" index="position">
    <li data-position="{{ position }}">{{ crop }}</li>
  </leaf:for>
</ul>`);
    expect(html).toBe(
      await renderToString(
        createElement(
          "ul",
          { id: "crops" },
          ["wheat", "barley", "rye"].map((crop, position) =>
            createElement("li", { "data-position": position }, crop),
          ),
        ),
      ),
    );
  });

  it("wires @event handlers, as a statement with `event` or as a function", async () => {
    const Counter = await load(`<script>
  import { useState } from "leaf";
  const [count, setCount] = useState(0);
  const reset = () => setCount(0);
</script>
<button id="add" @click="setCount(count + (event.detail || 1))">Clicked {{ count }} times</button>
<button id="reset" @click="reset">Reset</button>`);
    const container = document.createElement("div");
    createRoot(container).render(createElement(Counter, {}));
    const [add, reset] = Array.from(container.querySelectorAll("button"));

    add.click();
    await nextTask();
    expect(add.textContent).toBe("Clicked 1 times");
    reset.click();
    await nextTask();
    expect(add.textContent).toBe("Clicked 0 times");
  });

  it("renders a component whose render script awaits as an async component", async () => {
    // leaf renders an async component only when it streams.
    const Crops = await load(`<script>
  const crops = await Promise.resolve(["wheat", "rye"]);
</script>
<ul><leaf:for each="crop" in="crops"><li>{{ crop }}</li></leaf:for></ul>`);
    const stream = await renderToReadableStream(createElement(Crops, {}));
    const html = await new Response(stream).text();
    expect(html).toBe("<ul><li>wheat</li><li>rye</li></ul>");
  });

  it("renders components, their props, and children", async () => {
    const html = await render(
      `<script>
  const Badge = (badge) => <span class={badge.tone}>{badge.children}</span>;
</script>
<Badge tone="{{ props.tone }}">{{ props.label }}</Badge>`,
      { tone: "ripe", label: "Wheat" },
    );
    expect(html).toBe('<span class="ripe">Wheat</span>');
  });

  it('keeps a module script\'s "use client" as the first statement, ahead of the imports', () => {
    const code = compileLeaf(
      `<script module>
  "use client";
  export const island = "idle";
</script>
<script>
  import { useState } from "leaf";
  const [count] = useState(0);
</script>
<p>{{ count }}</p>`,
      "Test",
      "test.leaf",
    );
    expect(code.split("\n").slice(0, 3)).toEqual([
      '"use client";',
      'import { useState } from "leaf";',
      'export const island = "idle";',
    ]);
  });
});

describe(".leaf errors", () => {
  const cases = [
    ["JSX braces in text", "<p>\n  {count}\n</p>", /test\.leaf:2: `\{` starts a JSX expression.*\{\{ value \}\}/],
    ["a JSX attribute", '<button\n  onClick={() => save()}>Save</button>', /test\.leaf:2: `onClick=\{\.\.\.\}` is JSX.*@click/],
    ["an unclosed element", "<section>\n  <p>Hi</p>\n", /test\.leaf:1: `<section>` is never closed/],
    ["a mismatched closing tag", "<section>\n<p>Hi</section>", /test\.leaf:2: `<\/section>` closes `<p>` from line 2/],
    ["<leaf:else> without <leaf:if>", "<leaf:else>no</leaf:else>", /`<leaf:else>` must come right after `<leaf:if>`/],
    ["<leaf:if> without test", "<leaf:if>yes</leaf:if>", /`<leaf:if>` needs the `test` attribute/],
    ["<leaf:for> without in", '<leaf:for each="crop"></leaf:for>', /`<leaf:for>` needs the `in` attribute/],
    ["an unknown leaf tag", "<leaf:switch></leaf:switch>", /`<leaf:switch>` isn't a leaf tag/],
    ["an empty value", "<p>{{ }}</p>", /`\{\{ \}\}` is empty/],
    ["an event without a handler", "<button @click>Save</button>", /`@click` on `<button>` needs a handler/],
  ];

  for (const [name, markup, message] of cases) {
    it(`reports ${name} with its line and a fix`, () => {
      expect(() => compileLeaf(markup, "Test", "test.leaf")).toThrow(LeafCompileError);
      expect(() => compileLeaf(markup, "Test", "test.leaf")).toThrow(message);
    });
  }

  it("counts lines from the top of the file, scripts included", () => {
    const source = '<script>\nconst a = 1;\n</script>\n\n<p>{a}</p>';
    expect(() => compileLeaf(source, "Test", "test.leaf")).toThrow(/test\.leaf:5:/);
  });
});
