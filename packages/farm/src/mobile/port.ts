/**
 * The React Native port of a portable page (RFC 0004, 7.8 stage 2). The analyzer proved the page
 * portable; this copies the page and the app components it imports, renaming each DOM element to
 * `@farm.js/native/elements` (`<div>` to `<__FarmDom.div>`) and leaving everything else as written,
 * so the page's hooks and handlers run unchanged on the device.
 *
 * It handles less than the analyzer allows, and says so: a route it cannot emit stays web, with
 * the reason in `problems`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FarmMobilePortGraph } from "./analyzer";
import {
  cascadeFarmNativeStylesheetsForElement,
  inspectFarmNativeStylesheets,
  parseFarmNativeStylesheet,
} from "./native-css";
import {
  createFarmNativeTheme,
  farmNativeClassProblem,
  resolveFarmNativeClasses,
  type FarmNativeStyle,
} from "./native-style";

/** Elements `@farm.js/native/elements` draws. */
const DOM_TAGS = new Set(
  (
    "div section main article header footer nav aside figure hr p h1 h2 h3 h4 h5 h6 span strong " +
    "em b i small code label br a button input textarea img ul ol li"
  ).split(" "),
);

/** DOM props the elements read, or that have no effect on a device and can be ignored. */
const DOM_PROPS = new Set(
  (
    "key style href src alt width height value defaultValue placeholder type disabled readOnly " +
    "autoFocus maxLength rows name id title role htmlFor target rel tabIndex lang dir " +
    "onClick onChange onInput onFocus onBlur onLoad onError"
  ).split(" "),
);

const REACT_NAMES = new Set(
  (
    "default Fragment StrictMode memo forwardRef useState useReducer useMemo useCallback " +
    "useEffect useRef useId useTransition useDeferredValue startTransition"
  ).split(" "),
);

/** Pure JS packages a port imports as they are. */
const PURE_PACKAGES = new Set([
  "zod",
  "valibot",
  "date-fns",
  "dayjs",
  "lodash",
  "lodash-es",
  "nanoid",
  "uuid",
  "clsx",
  "classnames",
  "tailwind-merge",
  "zustand",
  "jotai",
  "immer",
]);

const CORE_LINK = new Set(["@farm.js/core", "@farm.js/core/client"]);
const SCRIPT = /\.(?:tsx|ts|jsx|js|mjs)$/;

export interface FarmMobilePort {
  /** The screen module the native entry registers, relative to the ports directory. */
  entry: string;
  /** Generated sources, keyed by path relative to the ports directory. */
  files: Record<string, string>;
}

export type FarmMobilePortResult = { port: FarmMobilePort } | { problems: string[] };

type Node = { type: string; start: number; end: number; [key: string]: any };
type ParseSync = (
  file: string,
  source: string,
  options: { lang: string },
) => { program: Node; errors?: unknown[] };

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function posix(file: string): string {
  return file.split(path.sep).join("/");
}

function withoutExtension(file: string): string {
  return file.replace(SCRIPT, "");
}

function specifierBetween(fromFile: string, toFile: string): string {
  const relative = posix(path.relative(path.dirname(fromFile), withoutExtension(toFile)));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const current = node as Node;
  if (typeof current.type === "string") visit(current);
  for (const [key, value] of Object.entries(current)) {
    if (key !== "type" && key !== "start" && key !== "end" && value && typeof value === "object") {
      walk(value, visit);
    }
  }
}

function hasJsx(program: Node): boolean {
  let found = false;
  walk(program, (node) => {
    if (node.type === "JSXElement" || node.type === "JSXFragment") found = true;
  });
  return found;
}

/** A JSX attribute's static string: `"a b"`, `{"a b"}`, or a template without expressions. */
function staticString(value: Node | null | undefined): string | undefined {
  if (!value) return undefined;
  if (
    (value.type === "Literal" || value.type === "StringLiteral") &&
    typeof value.value === "string"
  ) {
    return value.value;
  }
  if (value.type === "JSXExpressionContainer") return staticString(value.expression);
  if (value.type === "TemplateLiteral" && value.expressions.length === 0) {
    return value.quasis.map((quasi: Node) => quasi.value.cooked).join("");
  }
  return undefined;
}

function lineColumn(source: string, offset: number): string {
  const before = source.slice(0, offset).split("\n");
  return `${before.length}:${before.at(-1)!.length + 1}`;
}

/**
 * Emit the port of one route from the analyzer's graph of its page. `portsDir` is where the files
 * will be written; the copies keep their path under the app root inside it.
 */
export async function emitFarmMobilePort(options: {
  root: string;
  graph: FarmMobilePortGraph;
  portsDir: string;
  /** The page's module id, such as `app/lab/packing`, which names the screen entry. */
  module: string;
  /** The app's plain `.css` files; a production build links them on every page. */
  stylesheets?: readonly string[];
  /** Stylesheets that are not plain CSS (package CSS, Sass), by specifier. */
  unreadStylesheets?: readonly string[];
  readFile?: (file: string) => string;
}): Promise<FarmMobilePortResult> {
  const { root, graph, portsDir } = options;
  const read = options.readFile ?? ((file: string) => readFileSync(file, "utf8"));
  const { parseSync } = (await import("rolldown/utils")) as unknown as { parseSync: ParseSync };
  const problems: string[] = [];
  const copyOf = (file: string) => path.join(portsDir, path.relative(root, file));

  const parsed = new Map<string, { source: string; program: Node }>();
  for (const module of graph.modules) {
    const source = read(module.file);
    const lang = module.file.endsWith(".tsx") ? "tsx" : module.file.endsWith(".ts") ? "ts" : "jsx";
    parsed.set(module.file, { source, program: parseSync(module.file, source, { lang }).program });
  }
  // Modules with JSX are copied and rewritten; the rest are imported where they are.
  const copied = new Set(
    graph.modules
      .filter((module) => module.file === graph.page || hasJsx(parsed.get(module.file)!.program))
      .map((module) => module.file),
  );

  const files: Record<string, string> = {};
  // Every element the port renders, for the app's CSS, and each static className, resolved once
  // every class the port renders is known.
  const tags = new Set<string>();
  const classNames: Array<{
    edits: Array<{ start: number; end: number; text: string }>;
    attribute: Node;
    tag: string;
    classes: string[];
    at: string;
  }> = [];
  const outputs: Array<{
    key: string;
    label: string;
    source: string;
    edits: Array<{ start: number; end: number; text: string }>;
  }> = [];
  for (const module of graph.modules) {
    const label = posix(path.relative(root, module.file));
    if (module.serverBoundary) {
      problems.push(`${label} defines server functions, which ports do not call yet`);
      continue;
    }
    if (!copied.has(module.file)) continue;
    const { source, program } = parsed.get(module.file)!;
    const at = (node: Node) => `${label}:${lineColumn(source, node.start)}`;
    const edits: Array<{ start: number; end: number; text: string }> = [];
    const resolvedBySource = new Map(module.imports.map((entry) => [entry.source, entry.file]));
    const linkNames = new Set<string>();
    // `React` in `React.useContext`, from a default or namespace import.
    const reactObjects = new Set<string>();
    let usesDom = false;

    const rewriteSource = (node: Node, kind: "value" | "type") => {
      const specifier = node.value as string;
      const target = resolvedBySource.get(specifier);
      if (target) {
        if (kind === "value" && !SCRIPT.test(target)) {
          problems.push(`${at(node)} imports "${specifier}", an asset ports do not load yet`);
          return;
        }
        const next = specifierBetween(
          copyOf(module.file),
          copied.has(target) ? copyOf(target) : target,
        );
        edits.push({ start: node.start, end: node.end, text: JSON.stringify(next) });
        return;
      }
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        if (kind === "value") {
          problems.push(`${at(node)} imports "${specifier}", an asset ports do not load yet`);
        }
        return;
      }
      if (kind === "type" || specifier === "react" || PURE_PACKAGES.has(packageName(specifier))) {
        return;
      }
      if (!CORE_LINK.has(specifier)) {
        problems.push(`${at(node)} imports "${specifier}", which ports do not map yet`);
      }
    };

    for (const statement of program.body as Node[]) {
      if (statement.type === "ImportDeclaration") {
        const typeOnly = statement.importKind === "type";
        const specifier = statement.source.value as string;
        if (!typeOnly && specifier === "react") {
          for (const imported of statement.specifiers as Node[]) {
            if (imported.importKind === "type") continue;
            if (imported.type !== "ImportSpecifier") reactObjects.add(imported.local.name);
            const name =
              imported.type === "ImportSpecifier"
                ? (imported.imported.name ?? imported.imported.value)
                : "default";
            if (!REACT_NAMES.has(name)) {
              problems.push(
                `${at(imported)} uses ${name} from "react", which ports do not support yet`,
              );
            }
          }
        }
        // The app's CSS reaches the port through its sheet, not the import.
        if (/\.css$/i.test(specifier)) {
          if ((statement.specifiers as Node[]).length > 0) {
            problems.push(`${at(statement)} imports CSS module names, which ports do not map yet`);
          } else edits.push({ start: statement.start, end: statement.end, text: "" });
          continue;
        }
        if (!typeOnly && CORE_LINK.has(specifier)) {
          const values = (statement.specifiers as Node[]).filter(
            (imported) => imported.importKind !== "type",
          );
          for (const imported of values) {
            const name = imported.type === "ImportSpecifier" ? imported.imported.name : "default";
            if (name === "Link") linkNames.add(imported.local.name);
            else
              problems.push(
                `${at(imported)} uses ${name} from "${specifier}", which ports do not map yet`,
              );
          }
          // `Link` comes from the elements runtime instead; only the types stay.
          const types = (statement.specifiers as Node[]).filter(
            (imported) => imported.importKind === "type",
          );
          edits.push({
            start: statement.start,
            end: statement.end,
            text:
              types.length === 0
                ? ""
                : `import type { ${types
                    .map((imported) =>
                      source.slice(imported.start, imported.end).replace(/^type\s+/, ""),
                    )
                    .join(", ")} } from ${JSON.stringify(specifier)};`,
          });
          continue;
        }
        rewriteSource(statement.source, typeOnly ? "type" : "value");
      } else if (
        (statement.type === "ExportNamedDeclaration" ||
          statement.type === "ExportAllDeclaration") &&
        statement.source
      ) {
        rewriteSource(statement.source, statement.exportKind === "type" ? "type" : "value");
      }
    }

    walk(program, (node) => {
      if (
        node.type === "MemberExpression" &&
        node.object?.type === "Identifier" &&
        reactObjects.has(node.object.name) &&
        node.property?.type === "Identifier" &&
        !REACT_NAMES.has(node.property.name)
      ) {
        problems.push(
          `${at(node)} uses ${node.property.name} from "react", which ports do not support yet`,
        );
      }
      if (node.type === "ImportExpression") {
        problems.push(`${at(node)} imports a module at runtime, which ports do not follow yet`);
      }
      if (node.type === "JSXOpeningElement" || node.type === "JSXClosingElement") {
        const name = node.name as Node;
        if (name.type !== "JSXIdentifier") return;
        const className = (tag: string) => {
          if (node.type !== "JSXOpeningElement") return;
          for (const attribute of node.attributes as Node[]) {
            if (attribute.type !== "JSXAttribute" || attribute.name.name !== "className") continue;
            const classes = staticString(attribute.value);
            if (classes === undefined) {
              problems.push(`${at(attribute)} <${tag}> builds its class names at runtime`);
              continue;
            }
            classNames.push({
              edits,
              attribute,
              tag,
              classes: classes.split(/\s+/).filter(Boolean),
              at: at(attribute),
            });
          }
        };
        if (linkNames.has(name.name)) {
          edits.push({ start: name.start, end: name.end, text: "__FarmLink" });
          tags.add("a");
          className("a");
          return;
        }
        if (!/^[a-z]/.test(name.name)) return;
        if (!DOM_TAGS.has(name.name)) {
          if (node.type === "JSXOpeningElement") {
            problems.push(`${at(node)} renders <${name.name}>, which ports do not draw yet`);
          }
          return;
        }
        usesDom = true;
        tags.add(name.name);
        edits.push({ start: name.start, end: name.end, text: `__FarmDom.${name.name}` });
        if (node.type !== "JSXOpeningElement") return;
        for (const attribute of node.attributes as Node[]) {
          if (attribute.type === "JSXSpreadAttribute") {
            problems.push(`${at(attribute)} spreads props on <${name.name}>`);
            continue;
          }
          const prop =
            attribute.name.type === "JSXNamespacedName"
              ? `${attribute.name.namespace.name}:${attribute.name.name.name}`
              : (attribute.name.name as string);
          if (prop !== "className" && !DOM_PROPS.has(prop) && !/^(?:aria|data)-/.test(prop)) {
            problems.push(`${at(attribute)} <${name.name} ${prop}> has no port mapping yet`);
          }
        }
        className(name.name);
      }
    });

    if (linkNames.size > 0 || usesDom) {
      const names = [
        ...(usesDom ? ["FarmDom as __FarmDom"] : []),
        ...(linkNames.size > 0 ? ["Link as __FarmLink"] : []),
      ];
      // After any directives ("use client"), which must stay first.
      const body = program.body as Node[];
      const first = body.find(
        (statement) => !(statement.type === "ExpressionStatement" && statement.directive),
      );
      edits.push({
        start: first?.start ?? source.length,
        end: first?.start ?? source.length,
        text: `import { ${names.join(", ")} } from "@farm.js/native/elements";\n`,
      });
    }

    outputs.push({
      key: posix(path.relative(portsDir, copyOf(module.file))),
      label,
      source,
      edits,
    });
  }

  const page = parsed.get(graph.page)!;
  const hasDefault = (page.program.body as Node[]).some(
    (statement) => statement.type === "ExportDefaultDeclaration",
  );
  if (!hasDefault) problems.push(`${posix(path.relative(root, graph.page))} has no default export`);

  // The app's CSS, which ports apply as the web page gets it. `@import "tailwindcss"` brings
  // Tailwind 4's preflight and the utilities in the native style table, and `@theme` blocks
  // change the values they resolve to; anything else that changes what a class means
  // (`@utility`, `@custom-variant`, Tailwind 3) keeps the route web.
  const sheets = [];
  const themeDeclarations: Array<[string, string]> = [];
  let tailwind = false;
  for (const file of options.stylesheets ?? []) {
    let css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    css = css.replace(/@import\s+(["'])tailwindcss\1[^;]*;/g, () => {
      tailwind = true;
      return "";
    });
    css = css.replace(/@source\b[^;]*;/g, "");
    // `@theme`, `@theme inline`, `@theme static`: declarations only, no nested blocks.
    css = css.replace(/@theme\b[^{;]*\{([^{}]*)\}/g, (_block, body: string) => {
      for (const match of body.matchAll(/(--[\w*-]+)\s*:\s*([^;]+);?/g)) {
        themeDeclarations.push([match[1]!, match[2]!.trim()]);
      }
      return "";
    });
    const directive =
      /@(?:import|layer|tailwind|apply|theme|utility|plugin|config|custom-variant|variant|reference)\b/.exec(
        css,
      );
    if (directive) {
      problems.push(
        `${posix(path.relative(root, file))} uses ${directive[0]}, which ports do not read yet`,
      );
    } else sheets.push(parseFarmNativeStylesheet(css));
  }
  for (const specifier of options.unreadStylesheets ?? []) {
    problems.push(`the app imports "${specifier}", which ports cannot read as plain CSS`);
  }
  const sheet: Record<
    string,
    { style?: FarmNativeStyle; dark?: FarmNativeStyle; inherit?: string[] }
  > = {};
  // Theme values may read each other or the app's `:root` variables, light and dark.
  const rootVars = {
    light: Object.assign(
      {},
      ...sheets.map((sheet) => sheet.vars.light),
      Object.fromEntries(themeDeclarations),
    ) as Record<string, string>,
    dark: Object.assign({}, ...sheets.map((sheet) => sheet.vars.dark)) as Record<string, string>,
  };
  const theme =
    themeDeclarations.length > 0 ? createFarmNativeTheme(themeDeclarations, rootVars) : undefined;
  const contextClasses = new Set([
    ...graph.layoutClasses,
    ...classNames.flatMap((entry) => entry.classes),
  ]);
  for (const { edits, attribute, tag, classes, at } of classNames) {
    // Tailwind's utilities sit in a layer, so the app's own rules (here, `css`) override them.
    const utilities: string[] = [];
    const appClasses: string[] = [];
    for (const token of classes) {
      const inTable = resolveFarmNativeClasses(token, theme).unsupported.length === 0;
      const styled = inspectFarmNativeStylesheets(sheets, { class: token }).styled;
      if (tailwind && inTable) utilities.push(token);
      if (styled) appClasses.push(token);
      else if (tailwind && !inTable) {
        problems.push(
          `${at} ${farmNativeClassProblem(token, theme) ?? `class "${token}" has no port style`}`,
        );
      }
    }
    const tw = resolveFarmNativeClasses(utilities.join(" "), theme);
    const css = cascadeFarmNativeStylesheetsForElement(
      sheets,
      { tag, classes: appClasses },
      contextClasses,
    );
    problems.push(...css.problems.map((message) => `${at} ${message}`));
    const resolved = {
      ...(utilities.length > 0
        ? { tw: { style: tw.style, ...(tw.dark ? { dark: tw.dark } : {}) } }
        : {}),
      css: {
        style: css.style,
        ...(Object.keys(css.dark).length > 0 ? { dark: css.dark } : {}),
        ...(css.inherit.length > 0 ? { inherit: css.inherit } : {}),
      },
    };
    edits.push({
      start: attribute.start,
      end: attribute.end,
      text: `__farm={${JSON.stringify(resolved)}}`,
    });
  }
  for (const { key, label, source, edits } of outputs) {
    let output = source;
    for (const edit of edits.sort(
      (left, right) => right.start - left.start || right.end - left.end,
    )) {
      output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    }
    files[key] =
      `// Generated by Farm from ${label} for its React Native port. Do not edit.\n${output}`;
  }
  for (const tag of ["html", "body", ...[...tags].sort()]) {
    const cascaded = cascadeFarmNativeStylesheetsForElement(sheets, { tag }, contextClasses);
    problems.push(...cascaded.problems);
    const entry = {
      ...(Object.keys(cascaded.style).length > 0 ? { style: cascaded.style } : {}),
      ...(Object.keys(cascaded.dark).length > 0 ? { dark: cascaded.dark } : {}),
      ...(cascaded.inherit.length > 0 ? { inherit: cascaded.inherit } : {}),
    };
    if (Object.keys(entry).length > 0) sheet[tag] = entry;
  }
  if (problems.length > 0) return { problems: [...new Set(problems)] };

  const hasMetadata = (page.program.body as Node[]).some(
    (statement) =>
      statement.type === "ExportNamedDeclaration" &&
      statement.declaration?.declarations?.some(
        (declaration: Node) => declaration.id?.name === "metadata",
      ),
  );
  const entry = `${options.module}.port.tsx`;
  const pageImport = specifierBetween(path.join(portsDir, entry), copyOf(graph.page));
  files[entry] = [
    `// Generated by Farm: the React Native port of ${posix(path.relative(root, graph.page))}. Do not edit.`,
    'import { useRouteParams } from "@farm.js/native";',
    'import { FarmDomScreen } from "@farm.js/native/elements";',
    `import Page from ${JSON.stringify(pageImport)};`,
    ...(hasMetadata ? [`export { metadata } from ${JSON.stringify(pageImport)};`] : []),
    "",
    "// The app's CSS for each element the page renders, light and dark.",
    `const sheet = ${JSON.stringify(sheet)};`,
    "",
    "export default function FarmPort() {",
    "  return (",
    `    <FarmDomScreen sheet={sheet}${tailwind ? " preflight" : ""}>`,
    "      <Page params={useRouteParams()} />",
    "    </FarmDomScreen>",
    "  );",
    "}",
    "",
  ].join("\n");
  return { port: { entry, files } };
}
