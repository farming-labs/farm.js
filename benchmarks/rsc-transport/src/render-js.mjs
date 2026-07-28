import { decodeDocument } from "./document.mjs";

const keywords = new Set(["async", "await", "const", "export", "function", "return"]);

export function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

export function tokenizeInline(input) {
  const tokens = [];
  let offset = 0;

  while (offset < input.length) {
    if (input.startsWith("**", offset)) {
      const end = input.indexOf("**", offset + 2);
      if (end !== -1) {
        tokens.push({ kind: "strong", text: input.slice(offset + 2, end) });
        offset = end + 2;
        continue;
      }
    }

    if (input[offset] === "`") {
      const end = input.indexOf("`", offset + 1);
      if (end !== -1) {
        tokens.push({ kind: "code", text: input.slice(offset + 1, end) });
        offset = end + 1;
        continue;
      }
    }

    if (input[offset] === "[") {
      const labelEnd = input.indexOf("](", offset + 1);
      const hrefEnd = labelEnd === -1 ? -1 : input.indexOf(")", labelEnd + 2);
      if (labelEnd !== -1 && hrefEnd !== -1) {
        tokens.push({
          kind: "link",
          text: input.slice(offset + 1, labelEnd),
          href: input.slice(labelEnd + 2, hrefEnd),
        });
        offset = hrefEnd + 1;
        continue;
      }
    }

    let end = offset + 1;
    while (
      end < input.length &&
      !input.startsWith("**", end) &&
      input[end] !== "`" &&
      input[end] !== "["
    ) {
      end += 1;
    }
    tokens.push({ kind: "text", text: input.slice(offset, end) });
    offset = end;
  }

  return tokens;
}

function isIdentifierStart(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36;
}

function isIdentifierPart(code) {
  return isIdentifierStart(code) || (code >= 48 && code <= 57);
}

export function tokenizeCode(source) {
  const tokens = [];
  let offset = 0;

  while (offset < source.length) {
    const code = source.charCodeAt(offset);

    if (source.startsWith("//", offset)) {
      let end = source.indexOf("\n", offset);
      if (end === -1) end = source.length;
      tokens.push({ kind: "comment", text: source.slice(offset, end) });
      offset = end;
      continue;
    }

    if (code === 32 || code === 9 || code === 10 || code === 13) {
      let end = offset + 1;
      while (end < source.length) {
        const next = source.charCodeAt(end);
        if (next !== 32 && next !== 9 && next !== 10 && next !== 13) break;
        end += 1;
      }
      tokens.push({ kind: "plain", text: source.slice(offset, end) });
      offset = end;
      continue;
    }

    if (code === 34 || code === 39 || code === 96) {
      const quote = code;
      let end = offset + 1;
      while (end < source.length) {
        const next = source.charCodeAt(end);
        if (next === 92) {
          end += 2;
          continue;
        }
        end += 1;
        if (next === quote) break;
      }
      tokens.push({ kind: "string", text: source.slice(offset, end) });
      offset = end;
      continue;
    }

    if (isIdentifierStart(code)) {
      let end = offset + 1;
      while (end < source.length && isIdentifierPart(source.charCodeAt(end))) end += 1;
      const text = source.slice(offset, end);
      tokens.push({ kind: keywords.has(text) ? "keyword" : "identifier", text });
      offset = end;
      continue;
    }

    if (code >= 48 && code <= 57) {
      let end = offset + 1;
      while (end < source.length) {
        const next = source.charCodeAt(end);
        if ((next < 48 || next > 57) && next !== 46) break;
        end += 1;
      }
      tokens.push({ kind: "number", text: source.slice(offset, end) });
      offset = end;
      continue;
    }

    tokens.push({ kind: "plain", text: source[offset] });
    offset += 1;
  }

  return tokens;
}

function renderInline(input) {
  return tokenizeInline(input)
    .map((token) => {
      const text = escapeHtml(token.text);
      if (token.kind === "strong") return `<strong>${text}</strong>`;
      if (token.kind === "code") return `<code>${text}</code>`;
      if (token.kind === "link") {
        return `<a href="${escapeHtml(token.href)}">${text}</a>`;
      }
      return text;
    })
    .join("");
}

function renderCode(source) {
  return tokenizeCode(source)
    .map((token) => {
      const text = escapeHtml(token.text);
      return token.kind === "plain" ? text : `<span class="tok-${token.kind}">${text}</span>`;
    })
    .join("");
}

export function renderDocumentToHtml(document) {
  const output = ['<article class="benchmark-article" data-fixture="transport-v1">'];

  for (const block of document.blocks) {
    if (block.type === "heading") {
      output.push(`<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`);
      continue;
    }

    if (block.type === "paragraph") {
      output.push(`<p>${renderInline(block.text)}</p>`);
      continue;
    }

    if (block.type === "code") {
      output.push(
        `<pre data-language="${escapeHtml(block.language)}"><code>${renderCode(block.source)}</code></pre>`,
      );
      continue;
    }

    if (block.type === "callout") {
      output.push(
        `<aside class="callout tone-${block.tone}"><strong>${escapeHtml(block.title)}</strong><p>${renderInline(block.body)}</p></aside>`,
      );
      continue;
    }

    if (block.type === "list") {
      output.push("<ul>");
      for (const item of block.items) output.push(`<li>${renderInline(item)}</li>`);
      output.push("</ul>");
      continue;
    }

    throw new Error(`Unknown block type: ${block.type}`);
  }

  output.push("</article>");
  return output.join("");
}

export function renderIr(input) {
  return renderDocumentToHtml(decodeDocument(input));
}
