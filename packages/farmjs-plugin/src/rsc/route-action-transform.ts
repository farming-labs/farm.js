const ROUTE_FACTORY_IMPORT_RE =
  /\bimport\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?(\{[^}]*\})\s+from\s*["']@farm.js\/core(?:\/routes)?["']\s*;?/g;
const EXPORTED_ROUTE_RE =
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\(/g;
const IMPORT_RE = /\bimport\s+(?!type\b)([\s\S]*?)\s+from\s*(["'][^"']+["'])\s*;?/g;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const MODULE_EXT_RE = /\.[cm]?[jt]sx?$/;

export type FarmRouteActionClientTransformResult = {
  code: string;
  routes: string[];
};

type ParsedRouteAction = {
  name: string;
  local: string;
};

type ParsedRoute = {
  exportName: string;
  pathSource: string;
  actions: ParsedRouteAction[];
  defaultAction: string;
};

/**
 * Replace a programmatic route imported by the browser with a small action-only
 * proxy. Route loaders, components, database imports, and other server code do
 * not enter the client graph.
 */
export function transformFarmRouteActionClients(
  code: string,
  id: string,
): FarmRouteActionClientTransformResult | null {
  if (!isTransformableModule(id) || !code.includes("createRoute") || !code.includes("actions")) {
    return null;
  }

  const routeFactories = findRouteFactoryImportNames(code);
  if (routeFactories.size === 0) return null;

  const routes = findActionRoutes(code, routeFactories, id);
  if (routes.length === 0) return null;

  const importStatements = findRuntimeImports(code);
  const requiredImports = new Set<string>();

  for (const route of routes) {
    for (const action of route.actions) {
      const statement = importStatements.get(action.local);
      if (!statement) {
        throw new Error(
          `[Farm.js] Route "${route.exportName}" action "${action.name}" in ${id} must reference ` +
            "a server function imported from another module. Define and export createServerFn in an actions module, then import it into the route.",
        );
      }
      requiredImports.add(statement);
    }
  }

  const output = [
    ...requiredImports,
    ...routes.map((route) => generateRouteActionProxy(route)),
    ...findRouteDefaultExports(code, routes),
  ].join("\n");

  return {
    code: `${output}\n`,
    routes: routes.map((route) => route.exportName),
  };
}

function findRouteFactoryImportNames(code: string): Set<string> {
  const names = new Set<string>();

  for (const match of code.matchAll(ROUTE_FACTORY_IMPORT_RE)) {
    const namedImports = (match[1] ?? "").slice(1, -1).split(",");
    for (const specifier of namedImports) {
      const normalized = specifier.trim().replace(/^type\s+/, "");
      const specifierMatch = normalized.match(/^createRoute(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (specifierMatch) names.add(specifierMatch[1] ?? "createRoute");
    }
  }

  return names;
}

function findActionRoutes(code: string, factories: Set<string>, id: string): ParsedRoute[] {
  const routes: ParsedRoute[] = [];

  for (const match of code.matchAll(EXPORTED_ROUTE_RE)) {
    const exportName = match[1];
    const calleeName = match[2];
    if (!exportName || !calleeName || !factories.has(calleeName)) continue;

    const openParen = (match.index ?? 0) + match[0].length - 1;
    const closeParen = findMatchingDelimiter(code, openParen, "(", ")");
    if (closeParen === -1) continue;

    const args = splitTopLevel(code, openParen + 1, closeParen);
    if (args.length < 2) continue;

    const pathSource = readSegment(code, args[0]);
    if (!isQuotedString(pathSource)) {
      throw new Error(
        `[Farm.js] Route "${exportName}" in ${id} must use a static string path before its actions can be imported by a Client Component.`,
      );
    }

    const options = readSegment(code, args[1]);
    if (!options.startsWith("{") || !options.endsWith("}")) continue;
    const properties = parseObjectProperties(options.slice(1, -1));
    const actionsSource = properties.get("actions");
    if (!actionsSource) continue;
    if (!actionsSource.startsWith("{") || !actionsSource.endsWith("}")) {
      throw new Error(
        `[Farm.js] Route "${exportName}" actions in ${id} must be an object literal so Farm can generate its client proxy.`,
      );
    }

    const actions = parseActionProperties(actionsSource.slice(1, -1), exportName, id);
    if (actions.length === 0) continue;

    const defaultSource = properties.get("defaultAction");
    const defaultAction = defaultSource
      ? parseStringValue(defaultSource, exportName, id)
      : actions[0]!.name;

    if (!actions.some((action) => action.name === defaultAction)) {
      throw new Error(
        `[Farm.js] Route "${exportName}" defaultAction "${defaultAction}" in ${id} does not match a declared action.`,
      );
    }

    routes.push({ exportName, pathSource, actions, defaultAction });
  }

  return routes;
}

function parseActionProperties(source: string, routeName: string, id: string): ParsedRouteAction[] {
  const properties = parseObjectProperties(source, true);
  const actions: ParsedRouteAction[] = [];

  for (const [name, value] of properties) {
    const local = value || name;
    if (!IDENTIFIER_RE.test(name) || !IDENTIFIER_RE.test(local)) {
      throw new Error(
        `[Farm.js] Route "${routeName}" actions in ${id} must use identifier entries such as { update } or { update: updateProduct }.`,
      );
    }
    actions.push({ name, local });
  }

  return actions;
}

function parseObjectProperties(source: string, allowShorthand = false): Map<string, string> {
  const properties = new Map<string, string>();

  for (const segment of splitTopLevel(source, 0, source.length)) {
    const entry = readSegment(source, segment);
    if (!entry) continue;
    if (entry.startsWith("...")) {
      properties.set(entry, "");
      continue;
    }

    const colon = findTopLevelColon(entry);
    if (colon === -1) {
      if (allowShorthand) properties.set(entry, "");
      continue;
    }

    const keySource = entry.slice(0, colon).trim();
    const value = entry.slice(colon + 1).trim();
    const key = isQuotedString(keySource) ? unquote(keySource) : keySource;
    properties.set(key, value);
  }

  return properties;
}

function findRuntimeImports(code: string): Map<string, string> {
  const imports = new Map<string, string>();

  for (const match of code.matchAll(IMPORT_RE)) {
    const clause = (match[1] ?? "").trim();
    const statement = match[0];
    const namedStart = clause.indexOf("{");
    const namedEnd = clause.lastIndexOf("}");

    if (namedStart > -1 && namedEnd > namedStart) {
      for (const specifier of clause.slice(namedStart + 1, namedEnd).split(",")) {
        const normalized = specifier.trim().replace(/^type\s+/, "");
        if (!normalized || specifier.trim().startsWith("type ")) continue;
        const parts = normalized.split(/\s+as\s+/);
        const local = parts[1] ?? parts[0];
        if (local && IDENTIFIER_RE.test(local)) imports.set(local, statement);
      }
    }

    const defaultImport = clause
      .slice(0, namedStart === -1 ? clause.length : namedStart)
      .replace(/,$/, "")
      .trim();
    if (IDENTIFIER_RE.test(defaultImport)) imports.set(defaultImport, statement);
  }

  return imports;
}

function generateRouteActionProxy(route: ParsedRoute): string {
  const actions = route.actions
    .map((action) => `${JSON.stringify(action.name)}: ${action.local}`)
    .join(", ");
  const defaultAction = route.actions.find((action) => action.name === route.defaultAction)!;

  return `export const ${route.exportName} = Object.freeze({
  __farmRouteActionTarget: true,
  path: ${route.pathSource},
  actions: Object.freeze({ ${actions} }),
  defaultAction: ${JSON.stringify(route.defaultAction)},
  action: ${defaultAction.local},
});`;
}

function findRouteDefaultExports(code: string, routes: ParsedRoute[]): string[] {
  const exports: string[] = [];
  for (const route of routes) {
    const defaultExport = new RegExp(
      `\\bexport\\s+default\\s+${escapeRegExp(route.exportName)}\\s*;?`,
    );
    if (defaultExport.test(code)) exports.push(`export default ${route.exportName};`);
  }
  return exports;
}

function splitTopLevel(source: string, start: number, end: number): Array<[number, number]> {
  const segments: Array<[number, number]> = [];
  let segmentStart = start;
  let parens = 0;
  let braces = 0;
  let brackets = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < end; index++) {
    const char = source[index];
    const next = source[index + 1];

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
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
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

    if (char === "(") parens++;
    else if (char === ")") parens--;
    else if (char === "{") braces++;
    else if (char === "}") braces--;
    else if (char === "[") brackets++;
    else if (char === "]") brackets--;
    else if (char === "," && parens === 0 && braces === 0 && brackets === 0) {
      segments.push([segmentStart, index]);
      segmentStart = index + 1;
    }
  }

  segments.push([segmentStart, end]);
  return segments;
}

function findTopLevelColon(source: string): number {
  const segments = splitTopLevel(source, 0, source.length);
  if (segments.length !== 1) return -1;

  let parens = 0;
  let braces = 0;
  let brackets = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") parens++;
    else if (char === ")") parens--;
    else if (char === "{") braces++;
    else if (char === "}") braces--;
    else if (char === "[") brackets++;
    else if (char === "]") brackets--;
    else if (char === ":" && parens === 0 && braces === 0 && brackets === 0) return index;
  }

  return -1;
}

function findMatchingDelimiter(
  source: string,
  openIndex: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;

  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
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
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
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
    if (char === open) depth++;
    else if (char === close && --depth === 0) return index;
  }

  return -1;
}

function readSegment(source: string, segment: [number, number]): string {
  return source.slice(segment[0], segment[1]).trim();
}

function parseStringValue(source: string, routeName: string, id: string): string {
  if (!isQuotedString(source)) {
    throw new Error(
      `[Farm.js] Route "${routeName}" defaultAction in ${id} must be a static string.`,
    );
  }
  return unquote(source);
}

function isQuotedString(value: string): boolean {
  return (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  );
}

function unquote(value: string): string {
  const quote = value[0];
  const body = value.slice(1, -1);
  if (quote === '"') return JSON.parse(value) as string;
  return body.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function isTransformableModule(id: string): boolean {
  const cleanId = id.split("?", 1)[0];
  return MODULE_EXT_RE.test(cleanId) && !/\.d\.[cm]?ts$/.test(cleanId);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
