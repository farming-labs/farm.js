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

const USE_SERVER_DIRECTIVE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use server\1/;

export function hasUseServerDirective(code: string): boolean {
  return USE_SERVER_DIRECTIVE.test(code);
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
