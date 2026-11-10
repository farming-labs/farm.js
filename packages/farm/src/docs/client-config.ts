import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";
import { isSecretDocsConfigKey } from "./config-secrets";

type AstNode = { type: string; start: number; end: number; [key: string]: unknown };

let parseAst: (typeof import("rolldown/parseAst"))["parseAst"] | undefined;

function propertyKeyName(property: AstNode): string | undefined {
  if (property.computed) return undefined;
  const key = property.key as AstNode;
  if (key.type === "Identifier") return key.name as string;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

/**
 * The docs config module as the browser may receive it: every scalar under a credential key
 * (`apiKey`, `token`, `secret`, ...), and every `headers` map, becomes `undefined`. The adapter
 * hydrates icons, MDX components, and callbacks from this module; credentials stay server-side.
 * Returns null when nothing needed redacting.
 */
export function redactFarmDocsClientConfig(code: string, filename: string): string | null {
  parseAst ??= (
    createRequire(typeof __filename === "string" ? __filename : import.meta.url)(
      "rolldown/parseAst",
    ) as typeof import("rolldown/parseAst")
  ).parseAst;
  const extension = path.extname(filename);
  const program = parseAst(code, {
    lang: extension === ".tsx" || extension === ".jsx" ? "tsx" : "ts",
  }) as unknown as AstNode;

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const current = node as AstNode;
    if (current.type === "Property") {
      const name = propertyKeyName(current);
      const valueType = (current.value as AstNode | undefined)?.type;
      // As in the engine's config map, an object under a credential-like key (`theme.tokens`)
      // is walked rather than dropped; a `headers` map is credentials throughout.
      const credential =
        name !== undefined &&
        (name.toLowerCase() === "headers" ||
          (isSecretDocsConfigKey(name) &&
            valueType !== "ObjectExpression" &&
            valueType !== "ArrayExpression"));
      if (name && credential) {
        // Shorthand (`{ apiKey }`) and methods have no separate value range to replace.
        edits.push(
          current.shorthand || current.method || current.kind !== "init"
            ? { start: current.start, end: current.end, text: `${JSON.stringify(name)}: undefined` }
            : {
                start: (current.value as AstNode).start,
                end: (current.value as AstNode).end,
                text: "undefined",
              },
        );
        return;
      }
    }
    for (const [key, value] of Object.entries(current)) {
      if (key !== "start" && key !== "end" && value && typeof value === "object") visit(value);
    }
  };
  visit(program);
  if (edits.length === 0) return null;

  let redacted = code;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    redacted = redacted.slice(0, edit.start) + edit.text + redacted.slice(edit.end);
  }
  return redacted;
}

/**
 * Whether a module id is the docs config module. Vite ids are real paths, while the configured
 * path may run through a symlink (macOS `/var` is `/private/var`).
 */
export function isFarmDocsClientConfigModule(
  id: string,
  configModule: string | undefined,
): boolean {
  if (!configModule) return false;
  const file = id.split("?")[0].replace(/\\/g, "/");
  if (file === configModule) return true;
  try {
    return file === realpathSync(configModule).replace(/\\/g, "/");
  } catch {
    return false;
  }
}

/** Redact the docs config module the client runtime imports for adapter hydration. */
export function farmDocsClientConfigPlugin(configModule: string | undefined): Plugin {
  return {
    name: "farm:docs-client-config",
    enforce: "pre",
    transform(code, id, options) {
      if (options?.ssr || !isFarmDocsClientConfigModule(id, configModule)) return null;
      const redacted = redactFarmDocsClientConfig(code, id.split("?")[0]);
      return redacted === null ? null : { code: redacted, map: null };
    },
  };
}
