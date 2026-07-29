import React from "react";
import { tokenizeCode, tokenizeInline } from "./render-js.mjs";

function renderInline(text, keyPrefix) {
  return tokenizeInline(text).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (token.kind === "strong") {
      return React.createElement("strong", { key }, token.text);
    }
    if (token.kind === "code") {
      return React.createElement("code", { key }, token.text);
    }
    if (token.kind === "link") {
      return React.createElement("a", { href: token.href, key }, token.text);
    }
    return token.text;
  });
}

function renderCode(source, keyPrefix) {
  return tokenizeCode(source).map((token, index) =>
    token.kind === "plain"
      ? token.text
      : React.createElement(
          "span",
          { className: `tok-${token.kind}`, key: `${keyPrefix}-${index}` },
          token.text,
        ),
  );
}

export function RscDocument({ document }) {
  return React.createElement(
    "article",
    { className: "benchmark-article", "data-fixture": "transport-v1" },
    document.blocks.map((block, index) => {
      const key = `block-${index}`;

      if (block.type === "heading") {
        return React.createElement(`h${block.level}`, { key }, block.text);
      }

      if (block.type === "paragraph") {
        return React.createElement("p", { key }, renderInline(block.text, key));
      }

      if (block.type === "code") {
        return React.createElement(
          "pre",
          { "data-language": block.language, key },
          React.createElement("code", null, renderCode(block.source, key)),
        );
      }

      if (block.type === "callout") {
        return React.createElement(
          "aside",
          { className: `callout tone-${block.tone}`, key },
          React.createElement("strong", null, block.title),
          React.createElement("p", null, renderInline(block.body, key)),
        );
      }

      if (block.type === "list") {
        return React.createElement(
          "ul",
          { key },
          block.items.map((item, itemIndex) =>
            React.createElement(
              "li",
              { key: `${key}-item-${itemIndex}` },
              renderInline(item, `${key}-item-${itemIndex}`),
            ),
          ),
        );
      }

      throw new Error(`Unknown block type: ${block.type}`);
    }),
  );
}

export function RscOpaqueHtmlDocument({ html }) {
  return React.createElement("div", {
    className: "opaque-html-boundary",
    "data-rsc-representation": "html",
    dangerouslySetInnerHTML: { __html: html },
  });
}
