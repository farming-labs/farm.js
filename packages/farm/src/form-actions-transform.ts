/**
 * Islands mode's `"use server"` transform (RFC 0003), run by islx's compiler. On the server, every
 * export of a `"use server"` module registers as a server action under a stable id, and an inline
 * `"use server"` function in a server component is hoisted with the variables it reads. In the
 * browser, a `"use server"` module becomes references that call those ids, so its code never
 * reaches a client bundle.
 */
import { createHash } from "node:crypto";
import { transformActions } from "@farmjs/islx/compiler";
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

export function transformFarmFormActionModule(options: {
  code: string;
  id: string;
  root: string;
  ssr: boolean;
  parse: (source: string) => AstNode;
}): string | null {
  // islx compiles both `"use server"` modules and inline `"use server"` functions; the runtime
  // is reached through Farm, so an app needs no dependency of its own.
  const result = transformActions({
    code: options.code,
    id: options.id,
    root: options.root,
    environment: options.ssr ? "server" : "client",
    parse: options.parse as never,
    runtime: {
      server: "@farm.js/core/internal/islx-server",
      client: "@farm.js/core/internal/islx-client",
    },
  });
  return result ? result.code : null;
}
