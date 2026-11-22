/**
 * How Farm reads a route module's `hydrate` export. The decision is made from the source text,
 * before any compiler runs, so one reader serves `.tsx` files, Vue and Svelte components, and any
 * file format a renderer adds.
 *
 * Nothing in this file may spell an opt-in as source text: core's bundle includes it, and the
 * hydration planner reads the modules a page imports as text.
 */

/** What a module's `hydrate` export reads as. `value` is null when it can't be read statically. */
export interface FarmHydrateExport {
  readonly value: boolean | null;
  /** What the export was written as, for error messages. */
  readonly found: string;
  /** Where the export starts in the source. */
  readonly index: number;
}

/** A line holding only a `//` comment, so a commented-out export doesn't count. */
const COMMENT_LINE = /^[ \t]*\/\/.*$/gm;

/** `export const|let|var hydrate[: T] = <value>`, or a function or class named `hydrate`. */
const DECLARATION =
  /\bexport\s+(?:(?:const|let|var)\s+hydrate(?![\w$])(?:\s*:[^=;\n]+)?\s*=\s*([^,;\n]*)|(?:async\s+)?(function|class)\b\s*\*?\s*hydrate(?![\w$]))/g;

/** An export list, with the module it re-exports from. */
const EXPORT_LIST = /\bexport\s*(type\s*)?\{([^}]*)\}(?:\s*from\s*(["'])([^"'\n]*)\3)?/g;

/** `true` or `false`, optionally `as const` or `satisfies boolean`. */
const BOOLEAN_LITERAL = /^(true|false)(?:\s+(?:as\s+const|satisfies\s+[\w$.]+))?$/;

export function readFarmHydrateExport(content: string | null): FarmHydrateExport | null {
  if (!content || !content.includes("hydrate")) return null;
  // Blanked rather than removed, so indexes still point into `content`.
  const source = content.replace(COMMENT_LINE, (line) => " ".repeat(line.length));

  for (const match of source.matchAll(DECLARATION)) {
    if (match[2]) return { value: null, found: `a ${match[2]} declaration`, index: match.index };
    return readLiteral(match[1]!, match.index);
  }

  for (const match of source.matchAll(EXPORT_LIST)) {
    if (match[1]) continue;
    for (const specifier of match[2]!.split(",")) {
      const [local = "", exported = local] = specifier
        .trim()
        .split(/\s+as\s+/)
        .map((name) => name.trim().replace(/^(["'])(.*)\1$/, "$2"));
      if (exported !== "hydrate" || /^type\s/.test(local)) continue;
      if (match[4] !== undefined) {
        return { value: null, found: `a re-export from "${match[4]}"`, index: match.index };
      }
      const declaration = new RegExp(
        `\\b(?:const|let|var)\\s+${local.replace(/\$/g, "\\$")}(?![\\w$])(?:\\s*:[^=;\\n]+)?\\s*=\\s*([^,;\\n]*)`,
      ).exec(source);
      if (!declaration) {
        return {
          value: null,
          found: `\`${local}\`, which isn't declared with a literal value in this file`,
          index: match.index,
        };
      }
      return readLiteral(declaration[1]!, match.index);
    }
  }

  return null;
}

function readLiteral(text: string, index: number): FarmHydrateExport {
  const found = text.replace(/\s*(?:\/\/.*|\/\*.*?\*\/)\s*$/, "").trim();
  const literal = BOOLEAN_LITERAL.exec(found);
  return { value: literal ? literal[1] === "true" : null, found: `\`${found}\``, index };
}

/** The error for a page or layout whose `hydrate` export can't be read from its source. */
export function formatFarmHydrateExportError(
  hydrate: FarmHydrateExport,
  sourcePath: string | undefined,
): string {
  return (
    `\`hydrate\`${sourcePath ? ` in ${sourcePath}` : ""} must be \`true\` or \`false\` written in ` +
    `the file, but Farm found ${hydrate.found}. Farm reads it from the source, before bundling, ` +
    "to decide whether the route ships JavaScript, so it can't evaluate expressions, imports or " +
    "re-exports. Set it to the literal `true` or `false`."
  );
}
