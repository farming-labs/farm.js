import fs from "node:fs/promises";
import path from "node:path";

/**
 * tsup emits split CommonJS as ESM and converts it with sucrase, which rewrites
 * every `import(x)` to `Promise.resolve().then(() => _interopRequireWildcard(require(x)))`.
 * `require` cannot load a `file://` URL, a query string, or an ESM module with top-level
 * await, and resolves the "require" export condition instead of "import". Unsplit
 * CommonJS kept `import(x)`, so restore it.
 */
const CONVERTED_IMPORT =
  /Promise\.resolve\(\)\.then\(\(\) => _interopRequireWildcard\d*\(require\(/g;

export function restoreDynamicImports(code: string): string {
  let output = "";
  let cursor = 0;
  CONVERTED_IMPORT.lastIndex = 0;
  for (let match = CONVERTED_IMPORT.exec(code); match; match = CONVERTED_IMPORT.exec(code)) {
    const argumentStart = match.index + match[0].length;
    const argumentEnd = findClosingParenthesis(code, argumentStart);
    // `require(x)`, then `_interopRequireWildcard(...)`, then `.then(...)`.
    if (argumentEnd === -1 || code.slice(argumentEnd, argumentEnd + 3) !== ")))") {
      throw new Error(`Unrecognized converted dynamic import at offset ${match.index}`);
    }
    output += `${code.slice(cursor, match.index)}import(${code.slice(argumentStart, argumentEnd)})`;
    cursor = argumentEnd + 3;
    CONVERTED_IMPORT.lastIndex = cursor;
  }
  return output + code.slice(cursor);
}

/** Index of the `)` that closes the call whose arguments start at `start`, or -1. */
function findClosingParenthesis(code: string, start: number): number {
  let depth = 0;
  for (let index = start; index < code.length; index++) {
    const char = code[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipString(code, index);
      if (index === -1) return -1;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      if (depth === 0) return index;
      depth--;
    }
  }
  return -1;
}

/** Index of the quote that closes the string or template literal opened at `start`. */
function skipString(code: string, start: number): number {
  const quote = code[start];
  for (let index = start + 1; index < code.length; index++) {
    const char = code[index];
    if (char === "\\") {
      index++;
    } else if (char === quote) {
      return index;
    } else if (quote === "`" && char === "$" && code[index + 1] === "{") {
      let depth = 1;
      index += 2;
      for (; index < code.length && depth > 0; index++) {
        if (code[index] === '"' || code[index] === "'" || code[index] === "`") {
          index = skipString(code, index);
          if (index === -1) return -1;
        } else if (code[index] === "{") {
          depth++;
        } else if (code[index] === "}") {
          depth--;
        }
      }
      index--;
    }
  }
  return -1;
}

export async function restoreDynamicImportsInDirectory(directory: string): Promise<number> {
  let restored = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".cjs")) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    const code = await fs.readFile(filePath, "utf8");
    const next = restoreDynamicImports(code);
    if (next !== code) {
      await fs.writeFile(filePath, next);
      restored++;
    }
  }
  return restored;
}
