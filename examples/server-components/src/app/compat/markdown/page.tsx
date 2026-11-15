import Markdown from "react-markdown";

// react-markdown is ESM-only and renders on the server, with no client code.
export default function MarkdownPage() {
  return (
    <article data-testid="markdown">
      <Markdown>{"# Rendered on the server\n\nWith **bold** text and a [link](/compat/icons)."}</Markdown>
    </article>
  );
}
