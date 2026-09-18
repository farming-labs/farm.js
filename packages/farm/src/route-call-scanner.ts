/**
 * Tokenizer-aware extractor for programmatic route path literals.
 *
 * `page("/…")` / `createRoute("/…")` declarations are discovered by scanning raw source
 * files. A naive regex over the raw source matches the same call shape inside comments,
 * string literals, regex literals, and member-access calls (e.g. `pager.page("/x")`),
 * which can feed non-call text through `normalizeProgrammaticRoutePath` (crashing the
 * type-generation step) or silently widen the generated route unions with phantom paths.
 *
 * This module walks the source with a tiny lexer that classifies every code region
 * (skipping comments, string literals, template literals, and regex literals) and only
 * collects string-literal first arguments of real `page(…)` / `createRoute(…)` call
 * expressions. The previous significant token is tracked so member-access calls are
 * excluded and `/` is disambiguated as a regex literal versus a division operator.
 *
 * Static template-literal arguments (`` page(`/products/list`, …) `` with no `${…}`)
 * are preserved; dynamic templates are excluded.
 */

export function extractProgrammaticPageCallPathLiterals(source: string): string[] {
  const results = new Set<string>();
  const length = source.length;
  let cursor = 0;

  type PrevKind =
    | "none"
    | "identifier"
    | "keyword"
    | "value" // string, template, regex, number, or value keyword
    | "dot" // `.` member access
    | "questionDot" // `?.` optional member access
    | "spread" // `...`
    | "open" // `(`, `[`, `{`
    | "close" // `)`, `]`, `}`
    | "operator"; // anything else that may begin an expression
  let prev: PrevKind = "none";

  const isWhitespace = (char: string): boolean =>
    char === " " ||
    char === "\t" ||
    char === "\n" ||
    char === "\r" ||
    char === "\f" ||
    char === "\v";
  const isIdentifierStart = (char: string): boolean => /[A-Za-z_$]/.test(char);
  const isIdentifierPart = (char: string): boolean => /[A-Za-z0-9_$]/.test(char);
  const isDigit = (char: string): boolean => char >= "0" && char <= "9";

  // Keywords that are followed by an expression (regex literals may follow).
  const EXPRESSION_KEYWORDS = new Set([
    "return",
    "typeof",
    "delete",
    "void",
    "new",
    "throw",
    "instanceof",
    "in",
    "of",
    "await",
    "yield",
    "else",
    "do",
    "case",
  ]);
  // Identifier-like keywords that denote a value (division follows).
  const VALUE_KEYWORDS = new Set(["true", "false", "null", "this", "super", "undefined"]);

  const REGEX_CONTEXT: ReadonlySet<PrevKind> = new Set([
    "none",
    "open",
    "operator",
    "keyword",
    "spread",
  ]);

  function readIdentifier(start: number): { end: number; text: string } {
    let end = start;
    while (end < length && isIdentifierPart(source[end])) end++;
    return { end, text: source.slice(start, end) };
  }

  function readStringLiteral(
    start: number,
    quote: string,
  ): { end: number; content: string } | null {
    let end = start + 1;
    while (end < length) {
      const char = source[end];
      if (char === "\\") {
        end += 2;
        continue;
      }
      if (char === quote) {
        return { end: end + 1, content: source.slice(start + 1, end) };
      }
      end++;
    }
    return null;
  }

  function readTemplateLiteral(start: number): {
    end: number;
    content: string;
    dynamic: boolean;
  } | null {
    let end = start + 1;
    let dynamic = false;
    while (end < length) {
      const char = source[end];
      if (char === "\\") {
        end += 2;
        continue;
      }
      if (char === "`") {
        return { end: end + 1, content: source.slice(start + 1, end), dynamic };
      }
      if (char === "$" && source[end + 1] === "{") {
        dynamic = true;
        const after = skipTemplateInterpolation(end + 2);
        if (after === -1) return null;
        end = after;
        continue;
      }
      end++;
    }
    return null;
  }

  function skipTemplateInterpolation(start: number): number {
    let end = start;
    let depth = 1;
    while (end < length && depth > 0) {
      const char = source[end];
      if (char === "\\") {
        end += 2;
        continue;
      }
      if (char === "{") {
        depth++;
        end++;
        continue;
      }
      if (char === "}") {
        depth--;
        end++;
        continue;
      }
      if (char === '"' || char === "'") {
        const result = readStringLiteral(end, char);
        if (!result) return -1;
        end = result.end;
        continue;
      }
      if (char === "`") {
        const result = readTemplateLiteral(end);
        if (!result) return -1;
        end = result.end;
        continue;
      }
      end++;
    }
    return depth === 0 ? end : -1;
  }

  function readRegexLiteral(start: number): number | null {
    let end = start + 1;
    let inClass = false;
    while (end < length) {
      const char = source[end];
      if (char === "\\") {
        end += 2;
        continue;
      }
      if (char === "[") {
        inClass = true;
        end++;
        continue;
      }
      if (char === "]") {
        inClass = false;
        end++;
        continue;
      }
      if (char === "/" && !inClass) {
        end++;
        while (end < length && source[end] >= "a" && source[end] <= "z") end++;
        return end;
      }
      if (char === "\n") return null;
      end++;
    }
    return null;
  }

  function skipLineComment(start: number): number {
    let end = start + 2;
    while (end < length && source[end] !== "\n") end++;
    return end;
  }

  function skipBlockComment(start: number): number {
    let end = start + 2;
    while (end < length) {
      if (source[end] === "*" && source[end + 1] === "/") return end + 2;
      end++;
    }
    return end;
  }

  function readNumber(start: number): number {
    const first = source[start];
    let end = start;
    if (first === "0") {
      const prefix = source[start + 1];
      if (
        prefix === "x" ||
        prefix === "X" ||
        prefix === "o" ||
        prefix === "O" ||
        prefix === "b" ||
        prefix === "B"
      ) {
        end = start + 2;
        while (end < length && /[0-9a-fA-F_]/.test(source[end])) end++;
        if (source[end] === "n") end++;
        return end;
      }
    }
    while (end < length && (isDigit(source[end]) || source[end] === "_")) end++;
    if (source[end] === ".") {
      end++;
      while (end < length && (isDigit(source[end]) || source[end] === "_")) end++;
    }
    if (source[end] === "e" || source[end] === "E") {
      end++;
      if (source[end] === "+" || source[end] === "-") end++;
      while (end < length && (isDigit(source[end]) || source[end] === "_")) end++;
    }
    if (source[end] === "n") end++;
    return end;
  }

  function classifyWord(text: string): PrevKind {
    if (VALUE_KEYWORDS.has(text)) return "value";
    if (EXPRESSION_KEYWORDS.has(text)) return "keyword";
    return "identifier";
  }

  while (cursor < length) {
    const char = source[cursor];

    if (isWhitespace(char)) {
      cursor++;
      continue;
    }

    if (char === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(cursor);
      continue;
    }

    if (char === '"' || char === "'") {
      const result = readStringLiteral(cursor, char);
      prev = "value";
      cursor = result ? result.end : length;
      continue;
    }

    if (char === "`") {
      const result = readTemplateLiteral(cursor);
      prev = "value";
      cursor = result ? result.end : length;
      continue;
    }

    if (char === "/" && REGEX_CONTEXT.has(prev)) {
      const end = readRegexLiteral(cursor);
      if (end !== null) {
        prev = "value";
        cursor = end;
        continue;
      }
      // Not a regex literal: fall through to operator handling.
    }

    if (isIdentifierStart(char)) {
      const { end: idEnd, text } = readIdentifier(cursor);
      const isMemberAccess = prev === "dot" || prev === "questionDot";

      let next = idEnd;
      while (next < length && isWhitespace(source[next])) next++;

      if (!isMemberAccess && (text === "page" || text === "createRoute") && source[next] === "(") {
        let argStart = next + 1;
        while (argStart < length && isWhitespace(source[argStart])) argStart++;
        const quote = source[argStart];

        if (quote === '"' || quote === "'") {
          const arg = readStringLiteral(argStart, quote);
          if (arg) {
            results.add(arg.content);
            prev = "value";
            cursor = arg.end;
            continue;
          }
        } else if (quote === "`") {
          const arg = readTemplateLiteral(argStart);
          if (arg) {
            if (!arg.dynamic) results.add(arg.content);
            prev = "value";
            cursor = arg.end;
            continue;
          }
        }
      }

      prev = classifyWord(text);
      cursor = idEnd;
      continue;
    }

    if (isDigit(char) || (char === "." && isDigit(source[cursor + 1] || ""))) {
      prev = "value";
      cursor = readNumber(cursor);
      continue;
    }

    if (char === "?" && source[cursor + 1] === ".") {
      prev = "questionDot";
      cursor += 2;
      continue;
    }
    if (char === "." && source[cursor + 1] === "." && source[cursor + 2] === ".") {
      prev = "spread";
      cursor += 3;
      continue;
    }
    if (char === "." && source[cursor + 1] === ".") {
      prev = "operator";
      cursor += 2;
      continue;
    }
    if (char === ".") {
      prev = "dot";
      cursor += 1;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      prev = "open";
      cursor++;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      prev = "close";
      cursor++;
      continue;
    }

    prev = "operator";
    cursor++;
  }

  return results.size > 0 ? Array.from(results) : [];
}
