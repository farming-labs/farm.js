// Compiles a `.leaf` file into an ordinary module Farm can load:
//
//   <script module> ... </script>   module scope: imports and exports such as `hydrate`
//   <script> ... </script>          runs on every render, before the markup; `props` is in scope
//   markup                          HTML, returned by the default-exported component
//
// The markup is HTML with a few additions:
//
//   {{ expression }}                          a value, in text or inside an attribute
//   @click="statement"                        an event handler, with `event` in scope
//   <leaf:if test="..."> <leaf:else-if test="..."> <leaf:else>
//   <leaf:for each="item" in="items" index="i">
//
// It compiles to JSX against leaf's runtime, so a `.leaf` component and a `.tsx` one are the same
// thing once built.

const DIRECTIVES = /^(?:\s*(["'])[^"'\n]*\1;?[ \t]*(?=\n|$))+/;
const SCRIPT = /<script(\s+module)?\s*>([\s\S]*?)<\/script>/g;
const IMPORT = /^[ \t]*import\s(?:[^;'"]*?\sfrom\s*)?(["'])[^"'\n]+\1;?[ \t]*$/gm;
const TAG_NAME = /^[A-Za-z][\w.:-]*/;
const ATTRIBUTE_NAME = /^[^\s"'=<>/]+/;
const JSX_ATTRIBUTE_NAME = /^[A-Za-z_][\w-]*(?::[\w-]+)?$/;
const HANDLER_REFERENCE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const ATTRIBUTE_PROPS = { class: "className", for: "htmlFor" };
const EXAMPLES = {
  "leaf:if": '`<leaf:if test="count > 3">`',
  "leaf:else-if": '`<leaf:else-if test="count > 1">`',
  "leaf:for": '`<leaf:for each="crop" in="crops">`',
};

/** A `.leaf` file that can't compile. The message names the file, the line, and the fix. */
export class LeafCompileError extends Error {
  code = "LEAF_COMPILE_ERROR";

  constructor(file, line, reason) {
    super(`${file}:${line}: ${reason}`);
    this.name = "LeafCompileError";
    this.file = file;
    this.line = line;
  }
}

export function compileLeaf(source, name = "LeafComponent", file = "component.leaf") {
  let moduleScript = "";
  let renderScript = "";
  // Each script becomes as many newlines as it had, so markup errors report the file's own lines.
  const markup = source.replace(SCRIPT, (block, isModule, body) => {
    if (isModule) moduleScript += body;
    else renderScript += body;
    return block.replace(/[^\n]/g, "");
  });
  // Imports are module-level, wherever the file writes them.
  const imports = [];
  const body = renderScript.replace(IMPORT, (statement) => {
    imports.push(statement.trim());
    return "";
  });
  const jsx = emitChildren(parseMarkup(markup, file), file).trim();
  // A component that awaits renders on the server only, as an async component does in leaf.
  const isAsync = /\bawait\b/.test(body);
  // A directive such as "use client" only counts as the module's first statement, so it stays
  // ahead of the imports.
  const directives = DIRECTIVES.exec(moduleScript)?.[0] ?? "";
  return [
    ...(directives.trim() ? [directives.trim()] : []),
    ...imports,
    moduleScript.slice(directives.length).trim(),
    `export default ${isAsync ? "async " : ""}function ${name}(props) {`,
    body.trim(),
    `  return (<>${jsx}</>);`,
    "}",
    "",
  ].join("\n");
}

/** `badge.leaf` → `Badge`, `[name].leaf` → `Name`. */
export function componentName(file) {
  const base = file
    .split(/[\\/]/)
    .pop()
    .replace(/\.leaf$/, "");
  const words = base.match(/[A-Za-z0-9]+/g) ?? ["Leaf"];
  const name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  return /^[A-Za-z]/.test(name) ? name : `Leaf${name}`;
}

/** Markup → a tree of elements, text, and `{{ values }}`. */
function parseMarkup(markup, file) {
  const root = { kind: "element", tag: "", attributes: [], children: [], line: 1 };
  const open = [root];
  let index = 0;
  let line = 1;
  let text = "";

  const fail = (reason, at = line) => {
    throw new LeafCompileError(file, at, reason);
  };
  const current = () => open[open.length - 1];
  const advance = (count) => {
    for (let end = index + count; index < end; index++) if (markup[index] === "\n") line++;
  };
  const skipSpace = () => {
    while (/\s/.test(markup[index] ?? "")) advance(1);
  };
  const flushText = () => {
    if (text) current().children.push({ kind: "text", value: text });
    text = "";
  };

  const parseOpeningTag = () => {
    const tagLine = line;
    advance(1);
    const tag = TAG_NAME.exec(markup.slice(index))[0];
    advance(tag.length);
    const attributes = [];

    for (;;) {
      skipSpace();
      if (index >= markup.length) fail(`\`<${tag}>\` is never closed with \`>\`.`, tagLine);
      const selfClosing = markup.startsWith("/>", index);
      if (selfClosing || markup[index] === ">") {
        advance(selfClosing ? 2 : 1);
        return { node: { kind: "element", tag, attributes, children: [], line: tagLine }, selfClosing };
      }

      const attributeLine = line;
      const name = ATTRIBUTE_NAME.exec(markup.slice(index))?.[0];
      if (!name) fail(`\`<${tag}>\` has an attribute this compiler can't read.`);
      advance(name.length);
      skipSpace();
      if (markup[index] !== "=") {
        attributes.push({ name, value: null, line: attributeLine });
        continue;
      }
      advance(1);
      skipSpace();

      const quote = markup[index];
      if (quote === "{") {
        fail(
          `\`${name}={...}\` is JSX. In a .leaf file, write \`@click="..."\` for an event and \`${name}="{{ value }}"\` for a value.`,
        );
      }
      if (quote === '"' || quote === "'") {
        const end = markup.indexOf(quote, index + 1);
        if (end === -1) fail(`The value of \`${name}\` is never closed with ${quote}.`, attributeLine);
        attributes.push({ name, value: markup.slice(index + 1, end), line: attributeLine });
        advance(end + 1 - index);
      } else {
        const value = /^[^\s>]+/.exec(markup.slice(index))?.[0] ?? "";
        attributes.push({ name, value, line: attributeLine });
        advance(value.length);
      }
    }
  };

  while (index < markup.length) {
    if (markup.startsWith("<!--", index)) {
      const end = markup.indexOf("-->", index + 4);
      if (end === -1) fail("This comment is never closed. End it with `-->`.");
      advance(end + 3 - index);
      continue;
    }

    if (markup.startsWith("{{", index)) {
      flushText();
      const end = findValueEnd(markup, index + 2);
      if (end === -1) fail("This `{{` is never closed. End the value with `}}`.");
      const expression = markup.slice(index + 2, end).trim();
      if (!expression) fail("`{{ }}` is empty. Put a value inside, such as `{{ count }}`.");
      current().children.push({ kind: "value", expression });
      advance(end + 2 - index);
      continue;
    }

    const char = markup[index];
    if (char === "{") {
      fail(
        "`{` starts a JSX expression, which .leaf markup doesn't use. Write `{{ value }}` for a value, or `&#123;` for a literal brace.",
      );
    }

    if (char === "<" && markup[index + 1] === "/") {
      flushText();
      const match = /^<\/([A-Za-z][\w.:-]*)\s*>/.exec(markup.slice(index));
      if (!match) fail("This closing tag is malformed. Write it as `</tag>`.");
      const tag = match[1];
      const element = current();
      if (element === root) fail(`\`</${tag}>\` has no opening tag.`);
      if (element.tag !== tag) {
        fail(`\`</${tag}>\` closes \`<${element.tag}>\` from line ${element.line}. Close that first.`);
      }
      open.pop();
      advance(match[0].length);
      continue;
    }

    if (char === "<" && /[A-Za-z]/.test(markup[index + 1] ?? "")) {
      flushText();
      const { node, selfClosing } = parseOpeningTag();
      current().children.push(node);
      if (!selfClosing && !VOID_ELEMENTS.has(node.tag)) open.push(node);
      continue;
    }

    text += char;
    advance(1);
  }
  flushText();

  if (open.length > 1) {
    const unclosed = current();
    fail(`\`<${unclosed.tag}>\` is never closed. Close it with \`</${unclosed.tag}>\`.`, unclosed.line);
  }
  return root.children;
}

/** The index of the `}}` that ends a value starting at `start`, skipping strings and nested braces. */
function findValueEnd(markup, start) {
  let depth = 0;
  for (let index = start; index < markup.length; index++) {
    const char = markup[index];
    if (char === '"' || char === "'" || char === "`") {
      for (index++; index < markup.length && markup[index] !== char; index++) {
        if (markup[index] === "\\") index++;
      }
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      if (depth === 0 && markup[index + 1] === "}") return index;
      depth = Math.max(0, depth - 1);
    }
  }
  return -1;
}

function emitChildren(nodes, file) {
  let output = "";
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.kind === "text") {
      output += escapeText(node.value);
      continue;
    }
    if (node.kind === "value") {
      output += `{${node.expression}}`;
      continue;
    }

    if (node.tag === "leaf:if") {
      // The branches that follow, with only whitespace between them.
      const branches = [node];
      let next = index + 1;
      for (;;) {
        let peek = next;
        while (isBlank(nodes[peek])) peek++;
        const candidate = nodes[peek];
        if (candidate?.kind !== "element") break;
        if (candidate.tag !== "leaf:else-if" && candidate.tag !== "leaf:else") break;
        branches.push(candidate);
        next = peek + 1;
        if (candidate.tag === "leaf:else") break;
      }
      output += `{${emitCondition(branches, file)}}`;
      index = next - 1;
      continue;
    }
    if (node.tag === "leaf:else-if" || node.tag === "leaf:else") {
      throw new LeafCompileError(
        file,
        node.line,
        `\`<${node.tag}>\` must come right after \`<leaf:if>\` or \`<leaf:else-if>\`.`,
      );
    }
    if (node.tag === "leaf:for") {
      const each = expressionAttribute(node, "each", file);
      const items = expressionAttribute(node, "in", file);
      const position = optionalAttribute(node, "index");
      const parameters = position ? `${each}, ${position}` : each;
      output += `{(${items}).map((${parameters}) => (<>${emitChildren(node.children, file)}</>))}`;
      continue;
    }
    if (node.tag.startsWith("leaf:")) {
      throw new LeafCompileError(
        file,
        node.line,
        `\`<${node.tag}>\` isn't a leaf tag. Use \`<leaf:if>\`, \`<leaf:else-if>\`, \`<leaf:else>\`, or \`<leaf:for>\`.`,
      );
    }

    const attributes = node.attributes.map((attribute) => emitAttribute(attribute, node.tag, file));
    const opening = [node.tag, ...attributes].join(" ");
    output +=
      node.children.length === 0
        ? `<${opening} />`
        : `<${opening}>${emitChildren(node.children, file)}</${node.tag}>`;
  }
  return output;
}

function emitCondition(branches, file) {
  const [branch, ...rest] = branches;
  if (!branch) return "null";
  const children = `(<>${emitChildren(branch.children, file)}</>)`;
  if (branch.tag === "leaf:else") return children;
  const test = expressionAttribute(branch, "test", file);
  return `(${test}) ? ${children} : ${emitCondition(rest, file)}`;
}

function emitAttribute({ name, value, line }, tag, file) {
  if (name.startsWith("@")) {
    const event = name.slice(1);
    const code = value?.trim();
    if (!event || !code) {
      throw new LeafCompileError(
        file,
        line,
        `\`${name}\` on \`<${tag}>\` needs a handler, such as \`@click="save()"\`.`,
      );
    }
    const prop = `on${event[0].toUpperCase()}${event.slice(1)}`;
    // A name or path is the handler itself; anything else runs as a statement.
    return HANDLER_REFERENCE.test(code) ? `${prop}={${code}}` : `${prop}={(event) => { ${code}; }}`;
  }

  if (!JSX_ATTRIBUTE_NAME.test(name)) {
    throw new LeafCompileError(
      file,
      line,
      `\`${name}\` on \`<${tag}>\` isn't an attribute leaf can set. Use an HTML attribute name, or \`@event\` for an event.`,
    );
  }
  const prop = ATTRIBUTE_PROPS[name] ?? name;
  if (value === null) return prop;

  const parts = splitValues(value, file, line);
  if (parts.length === 1 && parts[0].kind === "value") return `${prop}={${parts[0].expression}}`;
  if (parts.every((part) => part.kind === "text")) {
    return value.includes('"') ? `${prop}={${JSON.stringify(value)}}` : `${prop}="${value}"`;
  }
  const template = parts
    .map((part) =>
      part.kind === "value"
        ? `\${${part.expression}}`
        : part.value.replace(/[`\\]|\$\{/g, (match) => `\\${match}`),
    )
    .join("");
  return `${prop}={\`${template}\`}`;
}

/** An attribute value → its text and `{{ values }}`, in order. */
function splitValues(value, file, line) {
  const parts = [];
  let index = 0;
  while (index < value.length) {
    const start = value.indexOf("{{", index);
    if (start === -1) {
      parts.push({ kind: "text", value: value.slice(index) });
      break;
    }
    if (start > index) parts.push({ kind: "text", value: value.slice(index, start) });
    const end = findValueEnd(value, start + 2);
    if (end === -1) {
      throw new LeafCompileError(file, line, "This `{{` is never closed. End the value with `}}`.");
    }
    parts.push({ kind: "value", expression: value.slice(start + 2, end).trim() });
    index = end + 2;
  }
  return parts;
}

/** The JavaScript in a leaf tag's attribute: `test="count > 3"`, or `test="{{ count > 3 }}"`. */
function expressionAttribute(element, name, file) {
  const value = optionalAttribute(element, name);
  if (!value) {
    const example = EXAMPLES[element.tag] ?? `\`${name}="..."\``;
    throw new LeafCompileError(
      file,
      element.line,
      `\`<${element.tag}>\` needs the \`${name}\` attribute, such as ${example}.`,
    );
  }
  return value;
}

function optionalAttribute(element, name) {
  const value = element.attributes.find((attribute) => attribute.name === name)?.value?.trim();
  return value?.replace(/^\{\{([\s\S]*)\}\}$/, "$1").trim() || undefined;
}

function isBlank(node) {
  return node?.kind === "text" && node.value.trim() === "";
}

/** Text as JSX text: JSX's whitespace rules apply, and characters JSX reserves become entities. */
function escapeText(text) {
  return text.replace(/[{}<>]/g, (char) => `&#${char.charCodeAt(0)};`);
}
