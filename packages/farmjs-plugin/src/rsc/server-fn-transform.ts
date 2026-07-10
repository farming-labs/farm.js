const CREATE_SERVER_FN_IMPORT_RE =
  /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s*["']@farmjs\/core(?:\/server-fn)?["']\s*;?/g;
const EXPORT_CREATE_SERVER_FN_RE =
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\(/g;
const MODULE_EXT_RE = /\.[cm]?[jt]sx?$/;
const DECLARATION_RE = /(^|\n)\s*["']([^"']+)["']\s*;?/g;

export type FarmServerFnTransformResult = {
  code: string;
  exports: string[];
};

export function transformFarmServerFns(
  code: string,
  id: string,
): FarmServerFnTransformResult | null {
  if (!isTransformableModule(id) || !code.includes("createServerFn")) return null;

  const createServerFnNames = findCreateServerFnImportNames(code);
  if (createServerFnNames.size === 0) return null;

  const replacements = findServerFnExportReplacements(code, createServerFnNames);
  if (replacements.length === 0) return null;

  if (hasModuleDirective(code, "use client")) {
    throw new Error(
      "createServerFn exports must live in a server module. Move them out of the 'use client' file.",
    );
  }

  let output = code;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, replacement.start) + replacement.code + output.slice(replacement.end);
  }

  if (!hasModuleDirective(output, "use server")) {
    output = `"use server";\n${output}`;
  }

  return {
    code: output,
    exports: replacements.map((replacement) => replacement.exportName),
  };
}

function isTransformableModule(id: string) {
  const cleanId = id.split("?", 1)[0];
  return MODULE_EXT_RE.test(cleanId) && !/\.d\.[cm]?ts$/.test(cleanId);
}

function findCreateServerFnImportNames(code: string) {
  const names = new Set<string>();

  for (const match of code.matchAll(CREATE_SERVER_FN_IMPORT_RE)) {
    const importClause = match[1] ?? "";
    const namedStart = importClause.indexOf("{");
    const namedEnd = importClause.lastIndexOf("}");
    if (namedStart === -1 || namedEnd === -1 || namedEnd <= namedStart) continue;

    const namedImports = importClause.slice(namedStart + 1, namedEnd).split(",");
    for (const specifier of namedImports) {
      const normalized = specifier.trim().replace(/^type\s+/, "");
      const specifierMatch = normalized.match(/^createServerFn(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (specifierMatch) {
        names.add(specifierMatch[1] ?? "createServerFn");
      }
    }
  }

  return names;
}

function findServerFnExportReplacements(code: string, createServerFnNames: Set<string>) {
  const replacements: Array<{
    start: number;
    end: number;
    code: string;
    exportName: string;
  }> = [];

  for (const match of code.matchAll(EXPORT_CREATE_SERVER_FN_RE)) {
    const exportName = match[1];
    const calleeName = match[2];
    if (!exportName || !calleeName || !createServerFnNames.has(calleeName)) continue;

    const openParenIndex = (match.index ?? 0) + match[0].length - 1;
    const callEnd = findMatchingParen(code, openParenIndex);
    if (callEnd === -1) continue;

    let declarationEnd = callEnd + 1;
    while (/\s/.test(code[declarationEnd] ?? "")) declarationEnd++;
    if (code[declarationEnd] === ";") declarationEnd++;

    const calleeIndex = code.indexOf(calleeName, match.index);
    const callExpression = code.slice(calleeIndex, callEnd + 1);
    const privateName = `$$farm_server_fn_${exportName}`;

    replacements.push({
      start: match.index ?? 0,
      end: declarationEnd,
      exportName,
      code: `const ${privateName} = ${callExpression};\nexport async function ${exportName}(input) {\n  return ${privateName}(input);\n}`,
    });
  }

  return replacements;
}

function hasModuleDirective(code: string, directive: "use client" | "use server") {
  for (const match of code.matchAll(DECLARATION_RE)) {
    const value = match[2];
    if (value === directive) return true;
    if (value !== "use strict" && value !== "use client" && value !== "use server") return false;
  }

  return false;
}

function findMatchingParen(code: string, openParenIndex: number) {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;

  for (let index = openParenIndex; index < code.length; index++) {
    const char = code[index];
    const next = code[index + 1];

    if (lineComment) {
      if (char === "\n" || char === "\r") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") depth++;
    if (char === ")") {
      depth--;
      if (depth === 0) return index;
    }
  }

  return -1;
}
