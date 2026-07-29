import { tokenizeCode, tokenizeInline } from "./render-js.mjs";

function text(value) {
  return { type: "text", value };
}

function element(tag, children = [], attributes) {
  return {
    type: "element",
    tag,
    ...(attributes ? { attributes } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function inlineNodes(input) {
  return tokenizeInline(input).map((token) => {
    if (token.kind === "strong") return element("strong", [text(token.text)]);
    if (token.kind === "code") return element("code", [text(token.text)]);
    if (token.kind === "link") {
      return element("a", [text(token.text)], { href: token.href });
    }
    return text(token.text);
  });
}

function codeNodes(source) {
  return tokenizeCode(source).map((token) =>
    token.kind === "plain"
      ? text(token.text)
      : element("span", [text(token.text)], { class: `tok-${token.kind}` }),
  );
}

export function createStrataDocument(document) {
  const children = document.blocks.map((block) => {
    if (block.type === "heading") {
      return element(`h${block.level}`, [text(block.text)]);
    }

    if (block.type === "paragraph") {
      return element("p", inlineNodes(block.text));
    }

    if (block.type === "code") {
      return element("pre", [element("code", codeNodes(block.source))], {
        "data-language": block.language,
      });
    }

    if (block.type === "callout") {
      return element(
        "aside",
        [element("strong", [text(block.title)]), element("p", inlineNodes(block.body))],
        { class: `callout tone-${block.tone}` },
      );
    }

    if (block.type === "list") {
      return element(
        "ul",
        block.items.map((item) => element("li", inlineNodes(item))),
      );
    }

    throw new Error(`Unknown block type: ${block.type}`);
  });

  return {
    type: "document",
    children: [
      element("article", children, {
        class: "benchmark-article",
        "data-fixture": "transport-v1",
      }),
    ],
  };
}
