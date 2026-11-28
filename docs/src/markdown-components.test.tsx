// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { components } from "./markdown-components";

describe("Markdown code", () => {
  it("gives fenced code a labelled toolbar and an initially hidden copy action", () => {
    const html = renderToStaticMarkup(
      createElement(components.pre, {
        children: createElement(components.code, {
          className: "language-bash",
          children: "pnpm dev\n",
        }),
      }),
    );
    expect(html).toContain("Terminal</span>");
    expect(html).toContain('aria-label="Copy Terminal code"');
    expect(html).toContain('hidden=""');
    expect(html).toContain('role="status"');
    expect(html).toContain(
      '<pre tabindex="0" aria-label="Terminal code"><code class="language-bash"',
    );
    expect(html).toContain('class="blog-code-actions"');
    expect(html).toContain('aria-hidden="true">bash</span>');
  });
  it.each([
    ["bash", 'curl -H "Accept: text/markdown" https://farmjs.dev/blog/0.1.0\n'],
    ["tsx", "export function App() { return <button disabled={false}>Save</button>; }\n"],
    ["jsx", 'export const App = () => <div title="<script>">Hello</div>;\n'],
    ["js", 'const message = "<script>alert(1)</script>";\n'],
    ["json", '{"quantity": 3, "label": "<script>"}\n'],
    ["rust", 'fn main() { println!("<script>"); }\n'],
    ["http", 'POST /api/orders HTTP/1.1\nContent-Type: application/json\n\n{"quantity": 3}\n'],
    ["html", "<button disabled>Save</button>\n"],
    ["dotenv", "API_URL=https://example.com\n"],
    ["md", "# Heading\n\n**Important**\n"],
    ["sh", 'echo "<script>"\n'],
    ["ts", 'const message: string = "<script>alert(1)</script>";\n'],
  ])("highlights %s on the server and escapes code as text", (language, source) => {
    const html = renderToStaticMarkup(
      createElement(components.code, {
        className: `language-${language}`,
        children: source,
      }),
    );
    expect(html).toContain('data-highlighted="true"');
    expect(html).toContain('<span style="color:');
    expect(html).not.toContain("<script>");
    // Remove presentation markup, then decode the text escaped by React.
    const text = html
      .replace(/<[^>]+>/g, "")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#x27;", "'")
      .replaceAll("&amp;", "&");
    expect(text).toBe(source);
  });

  it.each([
    ["ts", "TypeScript"],
    ["tsx", "React (TSX)"],
    ["jsx", "React (JSX)"],
    ["json", "JSON"],
    ["rust", "Rust"],
    ["http", "HTTP"],
  ])("labels %s blocks with their language", (language, label) => {
    const html = renderToStaticMarkup(
      createElement(components.pre, {
        children: createElement(components.code, {
          className: `language-${language}`,
          children: "example\n",
        }),
      }),
    );
    expect(html).toContain(`${label}</span>`);
    expect(html).toContain(`aria-label="Copy ${label} code"`);
  });

  it.each([undefined, "language-unknown", "language-text"])(
    "leaves inline and unsupported code readable (%s)",
    (className) => {
      const html = renderToStaticMarkup(
        createElement(components.code, {
          className,
          children: "<b>literal</b>\n",
        }),
      );
      expect(html).not.toContain("data-highlighted");
      expect(html).toContain("&lt;b&gt;literal&lt;/b&gt;\n</code>");
    },
  );
});
