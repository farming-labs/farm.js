/**
 * Islands mode's `"use server"` transform (RFC 0003). On the server, every export of a
 * `"use server"` module registers as a server action under a stable id. In the browser, the module
 * becomes stubs that call those ids, so its code and imports never reach a client bundle.
 */
import { createHash } from "node:crypto";
import path from "node:path";

interface AstNode {
  type: string;
  [key: string]: any;
}

/**
 * Whether the module's directive prologue (the strings before any other statement, after comments)
 * holds `"use server"`. A linear scan: a regular expression over leading comments backtracks
 * exponentially on a file that opens with many of them.
 */
export function hasUseServerDirective(code: string): boolean {
  let index = 0;
  while (index < code.length) {
    const char = code.charCodeAt(index);
    // Whitespace, including a byte order mark.
    if (char === 32 || (char >= 9 && char <= 13) || char === 0xfeff || char === 0xa0) {
      index++;
    } else if (code.startsWith("//", index)) {
      const end = code.indexOf("\n", index);
      if (end === -1) return false;
      index = end + 1;
    } else if (code.startsWith("/*", index)) {
      const end = code.indexOf("*/", index + 2);
      if (end === -1) return false;
      index = end + 2;
    } else if (char === 34 || char === 39) {
      const quote = code[index]!;
      const end = code.indexOf(quote, index + 1);
      if (end === -1) return false;
      const directive = code.slice(index + 1, end);
      index = end + 1;
      // A directive ends at a semicolon, a line break or the end of the file; a string followed by
      // anything else is an expression, and ends the prologue.
      while (index < code.length && /[ \t]/.test(code[index]!)) index++;
      if (code[index] === ";") index++;
      else if (index < code.length && code[index] !== "\n" && code[index] !== "\r") return false;
      if (directive === "use server") return true;
    } else {
      return false;
    }
  }
  return false;
}

/** The id an action has on both sides: the module's path from the app root and the export name. */
export function getFarmFormActionId(root: string, modulePath: string, exportName: string): string {
  const relative = path.relative(root, modulePath).split(path.sep).join("/");
  return createHash("sha256").update(`${relative}#${exportName}`).digest("base64url").slice(0, 22);
}

function collectExports(program: AstNode): Array<{ exported: string; local: string | null }> {
  const exports: Array<{ exported: string; local: string | null }> = [];
  for (const node of program.body ?? []) {
    if (node.type === "ExportNamedDeclaration") {
      const declaration = node.declaration;
      if (declaration?.type === "FunctionDeclaration" && declaration.id) {
        exports.push({ exported: declaration.id.name, local: declaration.id.name });
      } else if (declaration?.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations ?? []) {
          if (declarator.id?.type === "Identifier") {
            exports.push({ exported: declarator.id.name, local: declarator.id.name });
          }
        }
      }
      if (!node.source) {
        for (const specifier of node.specifiers ?? []) {
          const exported = specifier.exported?.name ?? specifier.exported?.value;
          const local = specifier.local?.name ?? null;
          if (exported) exports.push({ exported, local });
        }
      }
    } else if (node.type === "ExportDefaultDeclaration") {
      const declaration = node.declaration;
      const local =
        (declaration?.type === "FunctionDeclaration" && declaration.id?.name) ||
        (declaration?.type === "Identifier" && declaration.name) ||
        null;
      exports.push({ exported: "default", local });
    }
  }
  return exports;
}

export function transformFarmFormActionModule(options: {
  code: string;
  id: string;
  root: string;
  ssr: boolean;
  parse: (source: string) => AstNode;
}): string | null {
  const { code, id, root, ssr, parse } = options;
  if (!hasUseServerDirective(code)) return null;
  const modulePath = id.split("?", 1)[0]!;
  const exports = collectExports(parse(code));
  if (exports.length === 0) return null;
  const actionId = (name: string) => JSON.stringify(getFarmFormActionId(root, modulePath, name));

  if (!ssr) {
    const lines = [
      'import { createFarmFormActionStub as __farm_action_stub__ } from "@farm.js/core/internal/form-actions-client";',
    ];
    for (const entry of exports) {
      lines.push(
        entry.exported === "default"
          ? `export default __farm_action_stub__(${actionId("default")});`
          : `export const ${entry.exported} = __farm_action_stub__(${actionId(entry.exported)});`,
      );
    }
    return lines.join("\n") + "\n";
  }

  const registrations = exports.flatMap((entry) =>
    entry.local ? [`__farm_register_action__(${entry.local}, ${actionId(entry.exported)});`] : [],
  );
  if (registrations.length === 0) return null;
  return (
    code +
    '\nimport { registerFarmFormAction as __farm_register_action__ } from "@farm.js/core/internal/form-actions";\n' +
    registrations.join("\n") +
    "\n"
  );
}
