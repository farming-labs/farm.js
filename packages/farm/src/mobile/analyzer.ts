/**
 * Stage 0 of the auto-native analyzer (RFC 0004, 7.8): which page routes could become native
 * screens without changes, and why the others stay web. Report only: it changes no output.
 *
 * Build-time only. Loaded lazily by the mobile runtime when a report is asked for, so web builds
 * and `farm dev` never load it. It parses with Oxc (`rolldown/utils`, already a core dependency),
 * reads each module once per run, and reuses results across runs by content hash.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { FARM_VERSION } from "../version";

/**
 * Cached facts are reused only by the same analyzer: bump when facts change shape or rules
 * change between releases; a new Farm version always starts fresh.
 */
const ANALYZER_VERSION = `1:${FARM_VERSION}`;

export type FarmUiNodeKind = "View" | "Text" | "Image" | "Pressable" | "TextInput" | "List";

/** A minimal, platform-neutral UI tree for a portable component. No emitter reads it yet. */
export interface FarmUiNode {
  kind: FarmUiNodeKind | "Component" | "Fragment";
  /** The JSX tag it came from, such as `"button"` or `"Card"`. */
  tag: string;
  /** Static props, such as `href`, `src`, `alt`, `placeholder`. Expressions are `"{expr}"`. */
  props?: Record<string, string | number | boolean>;
  /** Tailwind classes and inline style keys that map to native style. */
  style?: string[];
  /** Event props, such as `["onClick"]`. */
  events?: string[];
  /** Static text children. */
  text?: string;
  children?: FarmUiNode[];
}

export interface FarmMobileBlocker {
  /** App-root-relative POSIX path. */
  file: string;
  line: number;
  column: number;
  rule: FarmMobileBlockerRule;
  message: string;
}

export type FarmMobileBlockerRule =
  | "parse-error"
  | "markdown-page"
  | "programmatic-route"
  | "server-component"
  | "async-component"
  | "unmapped-element"
  | "dangerously-set-inner-html"
  | "content-editable"
  | "dom-ref"
  | "dom-event"
  | "spread-props"
  | "form-action"
  | "dynamic-component"
  | "runtime-class-name"
  | "class-name"
  | "runtime-style"
  | "style"
  | "browser-global"
  | "layout-effect"
  | "create-element"
  | "css-import"
  | "dom-package"
  | "unknown-package"
  | "unmapped-import"
  | "unresolved-import"
  | "dynamic-import"
  | "node-builtin";

export type FarmMobileWin = "list" | "input" | "timer";

export interface FarmMobileElementCounts {
  /** JSX elements in the route's modules, intrinsic and imported components. */
  total: number;
  /** Elements with a native mapping. */
  mapped: number;
  byKind: Partial<Record<FarmUiNodeKind, number>>;
}

export interface FarmMobileRouteAnalysis {
  route: string;
  /**
   * `"port"`: portable and native would help (lists, input, timers). `"web"`: blocked, or
   * portable with no win. Any doubt is web.
   */
  decision: "port" | "web";
  portable: boolean;
  /** Every blocker, the page's module graph first, then its layouts'. */
  blockers: FarmMobileBlocker[];
  wins: FarmMobileWin[];
  elements: FarmMobileElementCounts;
  /** `mapped / total`, rounded, 100 for a route with no elements. */
  portablePercent: number;
  /** App modules in the route's graph, page and layouts. */
  modules: number;
  /** Byte size of `ir` as JSON. Portable routes only. */
  irBytes?: number;
  ir?: FarmMobileRouteIR;
}

export interface FarmMobileRouteIR {
  /** The page component, as `"<file>#default"`. */
  root: string;
  components: Record<string, FarmUiNode>;
}

export interface FarmMobileAnalyzerStats {
  /** Distinct app modules read. */
  modules: number;
  /** Modules parsed in this run; the rest came from the content-hash cache. */
  parsed: number;
  cached: number;
  ms: number;
}

export interface FarmMobileAnalyzerResult {
  routes: Record<string, FarmMobileRouteAnalysis>;
  stats: FarmMobileAnalyzerStats;
}

export interface FarmMobileAnalyzeOptions {
  root: string;
  srcDir?: string;
  /** Routes to analyze, with route groups removed. */
  routes: readonly string[];
  /** Absolute page file per file-based route; routes without one are programmatic. */
  pageFiles: ReadonlyMap<string, string>;
  /** `experimental.serverComponents` is on: pages and layouts without "use client" render on the server. */
  serverComponents?: boolean;
  /** Content-hash cache of module facts; written back after the run. */
  cacheFile?: string;
}

// ---------------------------------------------------------------------------------------------
// Tables

const INTRINSIC_KINDS: Record<string, FarmUiNodeKind> = {};
for (const tag of "div section main article header footer nav aside figure hr li".split(" ")) {
  INTRINSIC_KINDS[tag] = "View";
}
for (const tag of "p span h1 h2 h3 h4 h5 h6 strong em b i small label code br".split(" ")) {
  INTRINSIC_KINDS[tag] = "Text";
}
Object.assign(INTRINSIC_KINDS, {
  img: "Image",
  button: "Pressable",
  a: "Pressable",
  input: "TextInput",
  textarea: "TextInput",
  ul: "List",
  ol: "List",
});

const INPUT_TYPES = new Set(["text", "email", "password", "number", "search", "tel", "url"]);

/** Events with a native counterpart, per element kind. */
const MAPPED_EVENTS: Record<FarmUiNodeKind, ReadonlySet<string>> = {
  View: new Set(["onClick"]),
  Text: new Set(["onClick"]),
  Image: new Set(["onClick", "onLoad", "onError"]),
  Pressable: new Set(["onClick"]),
  TextInput: new Set(["onChange", "onInput", "onFocus", "onBlur"]),
  List: new Set(),
};

const BROWSER_GLOBALS = new Set(
  (
    "window document localStorage sessionStorage navigator matchMedia ResizeObserver " +
    "IntersectionObserver MutationObserver getComputedStyle requestAnimationFrame " +
    "cancelAnimationFrame location history indexedDB customElements HTMLElement Element " +
    "DOMParser screen visualViewport"
  ).split(" "),
);

/** Packages that are DOM-only by design. */
const DOM_PACKAGES = [
  "react-dom",
  "leaflet",
  "react-leaflet",
  "mapbox-gl",
  "chart.js",
  "react-chartjs-2",
  "recharts",
  "d3",
  "three",
  "@react-three/",
  "framer-motion",
  "motion",
  "@radix-ui/",
  "@headlessui/",
  "react-markdown",
  "@tiptap/",
  "prosemirror-",
  "@monaco-editor/",
  "monaco-editor",
  "codemirror",
  "@codemirror/",
  "swiper",
  "embla-carousel",
  "lucide-react",
  "react-icons",
  "@heroicons/",
  "shiki",
  "highlight.js",
  "prismjs",
  "styled-components",
  "@emotion/",
  "@stylexjs/",
];

/** Pure JS packages that run unchanged on a native screen. */
const PORTABLE_PACKAGES = new Set([
  "react",
  "@farm.js/ui",
  "@farm.js/native",
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
  "@tanstack/react-query",
  "zustand",
  "jotai",
  "immer",
]);

/**
 * `@farm.js/core` entry points and the names a native screen can use from each. Every name is a
 * real runtime export of that entry (a test checks), so a portable page is never blocked for
 * using the documented API, such as `navigateTo`.
 *
 * @internal Exported for tests.
 */
export const CORE_PORTABLE: Record<string, ReadonlySet<string>> = {
  "@farm.js/core": new Set([
    "Link",
    "createRoute",
    "useRouter",
    "useSearchParams",
    "usePathname",
    "navigateTo",
    "notFound",
    "redirect",
    "createServerFn",
    "createServerQuery",
  ]),
  "@farm.js/core/client": new Set([
    "Link",
    "useRouter",
    "navigateTo",
    "createApiClients",
    "useServerQuery",
  ]),
  "@farm.js/core/navigation": new Set([
    "useRouter",
    "useSearchParams",
    "usePathname",
    "notFound",
    "redirect",
  ]),
  "@farm.js/core/server-fn": new Set(["createServerFn"]),
  "@farm.js/core/server-query": new Set(["createServerQuery"]),
  "@farm.js/core/server-fn/client": new Set(["useServerFn"]),
  "@farm.js/core/server-query/client": new Set(["useServerQuery", "prefetchServerQuery"]),
  "@farm.js/core/api/client": new Set(["createApiClients"]),
  "@farm.js/core/image": new Set(["Image"]),
  "@farm.js/core/i18n/client": new Set(["useLocale", "useTranslations"]),
  "@farm.js/core/version": new Set(["FARM_VERSION"]),
  "@farm.js/core/platform": new Set(["platform"]),
};

/** Imported components with a native mapping. */
const MAPPED_COMPONENTS: Record<string, Record<string, FarmUiNodeKind>> = {
  "@farm.js/core": { Link: "Pressable" },
  "@farm.js/core/client": { Link: "Pressable" },
  "@farm.js/core/image": { Image: "Image" },
  "@farm.js/ui": {
    View: "View",
    Text: "Text",
    Image: "Image",
    Pressable: "Pressable",
    TextInput: "TextInput",
    List: "List",
  },
};

const SERVER_FN_FACTORIES = new Set(["createServerFn", "createServerQuery"]);

const SCRIPT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs"];
const STYLE_FILE = /\.(?:css|scss|sass|less|styl|stylus|pcss|postcss)(?:\?.*)?$/i;
const ASSET_FILE =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|json|woff2?|ttf|otf|mp3|wav|txt)(?:\?.*)?$/i;

// Inline style properties with a native counterpart. Values are checked separately.
const STYLE_PROPERTIES = new Set(
  (
    "display flexDirection flex flexGrow flexShrink flexBasis flexWrap alignItems alignSelf " +
    "alignContent justifyContent gap rowGap columnGap padding paddingTop paddingRight " +
    "paddingBottom paddingLeft paddingInline paddingBlock paddingHorizontal paddingVertical " +
    "margin marginTop marginRight marginBottom marginLeft marginInline marginBlock width height " +
    "minWidth minHeight maxWidth maxHeight color backgroundColor borderColor borderWidth " +
    "borderTopWidth borderRightWidth borderBottomWidth borderLeftWidth borderRadius borderStyle " +
    "opacity fontSize fontWeight fontStyle fontFamily lineHeight letterSpacing textAlign " +
    "textDecorationLine textTransform position top right bottom left zIndex overflow aspectRatio"
  ).split(" "),
);
const STYLE_ENUMS: Record<string, ReadonlySet<string>> = {
  display: new Set(["flex", "none"]),
  position: new Set(["relative", "absolute"]),
  overflow: new Set(["hidden", "visible"]),
};
const STYLE_VALUE_BLOCK =
  /\b(?:calc|var|env|min|max|clamp)\(|\d(?:vh|vw|dvh|svh|lvh|vmin|vmax|em|ch)\b/;

// ---------------------------------------------------------------------------------------------
// Tailwind subset

const COLOR =
  "(?:inherit|current|transparent|black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|" +
  "yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950))(?:/\\d{1,3})?";
const SPACE = "(?:\\d+(?:\\.5)?|px|auto)";
const SIZE = "(?:\\d+(?:\\.5)?|px|auto|full|\\d+/\\d+|min|max|fit)";
const PORTABLE_CLASSES = [
  /^(?:flex|flex-row|flex-col|flex-row-reverse|flex-col-reverse|flex-wrap|flex-nowrap|flex-wrap-reverse|flex-1|flex-auto|flex-initial|flex-none|grow|grow-0|shrink|shrink-0|hidden|relative|absolute|overflow-hidden|overflow-visible|italic|not-italic|underline|line-through|no-underline|uppercase|lowercase|capitalize|normal-case|text-left|text-center|text-right|text-justify)$/,
  /^(?:items|justify|self|content)-(?:start|end|center|between|around|evenly|stretch|baseline|auto)$/,
  new RegExp(
    `^-?(?:gap|gap-x|gap-y|p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me)-${SPACE}$`,
  ),
  new RegExp(`^(?:w|h|size|min-w|min-h|max-h)-${SIZE}$`),
  /^max-w-(?:none|xs|sm|md|lg|xl|[2-7]xl|full|min|max|fit)$/,
  new RegExp(`^-?(?:top|right|bottom|left|inset|inset-x|inset-y)-${SIZE}$`),
  /^z-(?:\d+|auto)$/,
  /^text-(?:xs|sm|base|lg|xl|[2-9]xl)$/,
  /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|sans|serif|mono)$/,
  /^leading-(?:none|tight|snug|normal|relaxed|loose|\d+)$/,
  /^tracking-(?:tighter|tight|normal|wide|wider|widest)$/,
  new RegExp(`^(?:text|bg|border|border-[trblxy])-${COLOR}$`),
  /^rounded(?:-[trbl]{1,2})?(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?$/,
  /^border(?:-[trblxy])?(?:-(?:0|2|4|8))?$/,
  /^border-(?:solid|dashed|dotted|none)$/,
  /^opacity-\d{1,3}$/,
  /^aspect-(?:square|video|auto)$/,
  // No effect on a touch screen; dropped on native.
  /^(?:cursor|select|outline|pointer-events)-[a-z-]+$/,
];
const BLOCKING_CLASSES: Array<[RegExp, string]> = [
  [/^(?:grid|inline-grid|grid-.+|col-.+|row-.+|auto-cols-.+|auto-rows-.+)$/, "uses grid layout"],
  [/^(?:fixed|sticky)$/, "uses fixed or sticky positioning"],
  [
    /^(?:transition.*|duration-.+|ease-.+|delay-.+|animate-.+)$/,
    "uses CSS transitions or keyframes",
  ],
  [/^(?:space-[xy]-.+|divide-.+)$/, "needs child selectors"],
  [
    /^(?:block|inline|inline-block|inline-flex|table.*|contents|flow-root|list-item)$/,
    "sets a display mode other than flex",
  ],
  [
    /^(?:shadow.*|ring.*|blur.*|backdrop-.+|drop-shadow.*|bg-gradient-.+|from-.+|via-.+|to-.+|bg-clip-.+|mix-blend-.+|filter|invert|grayscale.*|sepia.*)$/,
    "is a visual effect with no native mapping",
  ],
  [/^(?:container|prose.*|sr-only|not-sr-only)$/, "needs stylesheet rules"],
  [
    /^(?:truncate|line-clamp-.+|whitespace-.+|break-.+|text-ellipsis|text-clip)$/,
    "needs CSS text wrapping",
  ],
];

function classifyClass(token: string): string | undefined {
  const parts = token.split(":");
  const utility = parts.pop()!.replace(/^!/, "");
  const variant = parts.find((part) => part !== "dark");
  if (variant) {
    return /^(?:sm|md|lg|xl|2xl|min-.+|max-.+|portrait|landscape|print)$/.test(variant)
      ? `"${token}" is a media query`
      : `"${token}" needs the CSS ${variant}: selector`;
  }
  if (utility.includes("[")) return `"${token}" is an arbitrary value`;
  if (PORTABLE_CLASSES.some((pattern) => pattern.test(utility))) return undefined;
  for (const [pattern, why] of BLOCKING_CLASSES) {
    if (pattern.test(utility)) return `"${token}" ${why}`;
  }
  return `class "${token}" is not in the native Tailwind subset`;
}

// ---------------------------------------------------------------------------------------------
// Module facts: everything the route pass needs, derived from one module's source alone, so it
// can be cached by content hash.

interface ImportFact {
  source: string;
  line: number;
  column: number;
  /** Value names imported: `"default"`, `"*"`, or the export name. Empty for side effects. */
  names: string[];
  dynamic?: boolean;
  /** A dynamic import with a non-literal specifier. */
  computed?: boolean;
}

type LocalBlocker = Omit<FarmMobileBlocker, "file">;

interface ModuleFacts {
  imports: ImportFact[];
  blockers: LocalBlocker[];
  elements: FarmMobileElementCounts;
  wins: FarmMobileWin[];
  useClient: boolean;
  /** A server function module: the client calls it over the network, so it is data. */
  serverBoundary: boolean;
  asyncDefault: boolean;
  components: Record<string, FarmUiNode>;
}

type Node = { type: string; start: number; end: number; [key: string]: any };

function scriptLang(file: string): "ts" | "tsx" | "jsx" {
  return file.endsWith(".tsx") ? "tsx" : file.endsWith(".ts") ? "ts" : "jsx";
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = source.indexOf("\n"); index !== -1; index = source.indexOf("\n", index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

function locate(starts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - starts[low]! + 1 };
}

function collectPatternNames(pattern: Node | null | undefined, names: Set<string>): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      names.add(pattern.name);
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        collectPatternNames(
          property.type === "RestElement" ? property.argument : property.value,
          names,
        );
      }
      return;
    case "ArrayPattern":
      for (const element of pattern.elements) collectPatternNames(element, names);
      return;
    case "RestElement":
      collectPatternNames(pattern.argument, names);
      return;
    case "AssignmentPattern":
      collectPatternNames(pattern.left, names);
      return;
  }
}

function jsxName(name: Node): string {
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return `${jsxName(name.object)}.${name.property.name}`;
  if (name.type === "JSXNamespacedName") return `${name.namespace.name}:${name.name.name}`;
  return "?";
}

function attributeName(attribute: Node): string {
  return attribute.name.type === "JSXNamespacedName"
    ? `${attribute.name.namespace.name}:${attribute.name.name.name}`
    : attribute.name.name;
}

function staticString(value: Node | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value.type === "Literal" && typeof value.value === "string") return value.value;
  if (value.type === "JSXExpressionContainer") return staticString(value.expression);
  if (value.type === "TemplateLiteral" && value.expressions.length === 0) {
    return value.quasis.map((quasi: Node) => quasi.value.cooked ?? quasi.value.raw).join("");
  }
  return undefined;
}

const SKIP_KEYS = new Set([
  "type",
  "start",
  "end",
  "range",
  "loc",
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "decorators",
]);

/** Facts for one module's source. Pure: the same source always gives the same facts. */
function analyzeSource(file: string, source: string, parseSync: ParseSync): ModuleFacts {
  const facts: ModuleFacts = {
    imports: [],
    blockers: [],
    elements: { total: 0, mapped: 0, byKind: {} },
    wins: [],
    useClient: false,
    serverBoundary: false,
    asyncDefault: false,
    components: {},
  };
  const starts = lineStarts(source);
  const block = (node: { start: number }, rule: FarmMobileBlockerRule, message: string) => {
    facts.blockers.push({ ...locate(starts, node.start), rule, message });
  };
  const result = parseSync(file, source, { lang: scriptLang(file) });
  if (result.errors.length > 0) {
    const error = result.errors[0]!;
    const offset = error.labels?.[0]?.start ?? 0;
    facts.blockers.push({ ...locate(starts, offset), rule: "parse-error", message: error.message });
    return facts;
  }
  const program = result.program as unknown as Node;
  const wins = new Set<FarmMobileWin>();

  // Top-level bindings: imports and declarations, to resolve JSX component names.
  const imported = new Map<string, { source: string; name: string }>();
  /** Top-level functions, classes, and `memo`/`forwardRef`/`lazy` results: JSX components. */
  const topLevel = new Set<string>();
  const declared = new Set<string>();
  let callsServerFactory = false;
  const asyncFunctions = new Set<string>();
  let defaultName: string | undefined;

  for (const statement of program.body as Node[]) {
    if (statement.type === "ExpressionStatement" && statement.directive) {
      if (statement.directive === "use client") facts.useClient = true;
      if (statement.directive === "use server") facts.serverBoundary = true;
      continue;
    }
    if (statement.type === "ImportDeclaration") {
      const where = locate(starts, statement.start);
      if (statement.importKind === "type") continue;
      const names: string[] = [];
      for (const specifier of statement.specifiers as Node[]) {
        if (specifier.importKind === "type") continue;
        const name =
          specifier.type === "ImportDefaultSpecifier"
            ? "default"
            : specifier.type === "ImportNamespaceSpecifier"
              ? "*"
              : (specifier.imported.name ?? specifier.imported.value);
        names.push(name);
        imported.set(specifier.local.name, { source: statement.source.value, name });
        declared.add(specifier.local.name);
      }
      // `import { type A } from "x"` imports nothing at runtime.
      if (statement.specifiers.length > 0 && names.length === 0) continue;
      facts.imports.push({ source: statement.source.value, ...where, names });
      continue;
    }
    if (
      (statement.type === "ExportNamedDeclaration" || statement.type === "ExportAllDeclaration") &&
      statement.source &&
      statement.exportKind !== "type"
    ) {
      facts.imports.push({
        source: statement.source.value,
        ...locate(starts, statement.start),
        names:
          statement.type === "ExportAllDeclaration"
            ? ["*"]
            : (statement.specifiers as Node[])
                .filter((specifier) => specifier.exportKind !== "type")
                .map((specifier) => specifier.local.name ?? specifier.local.value),
      });
    }
    const declaration =
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement;
    if (!declaration) continue;
    if (declaration.id?.name && /Function|Class/.test(declaration.type)) {
      topLevel.add(declaration.id.name);
    }
    if (declaration.id?.name && declaration.async) asyncFunctions.add(declaration.id.name);
    if (statement.type === "ExportDefaultDeclaration" && declaration.type === "Identifier") {
      defaultName = declaration.name;
    }
    if (declaration.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations as Node[]) {
        if (declarator.id.type !== "Identifier") continue;
        const init = declarator.init as Node | null;
        if (init?.async) asyncFunctions.add(declarator.id.name);
        const callee = init?.type === "CallExpression" ? (init.callee as Node) : undefined;
        const calleeName =
          callee?.type === "MemberExpression" ? callee.property.name : callee?.name;
        if (
          /Function/.test(init?.type ?? "") ||
          (calleeName && /^(?:memo|forwardRef|lazy)$/.test(calleeName))
        ) {
          topLevel.add(declarator.id.name);
        }
      }
    }
    if (statement.type === "ExportDefaultDeclaration" && declaration.async)
      facts.asyncDefault = true;
  }

  const globalCandidates: Node[] = [];
  const blockGlobalsLater = () => {
    for (const node of globalCandidates) {
      if (!declared.has(node.name)) {
        block(node, "browser-global", `${node.name} is a browser API`);
      }
    }
  };

  const classifyElement = (element: Node): FarmUiNode => {
    const opening = element.openingElement as Node;
    const tag = jsxName(opening.name);
    let kind: FarmUiNode["kind"] | undefined;
    // Intrinsic elements and package components count; app components count through their
    // own module.
    let counted = true;
    const isIntrinsic = opening.name.type === "JSXIdentifier" && /^[a-z]/.test(tag);
    if (isIntrinsic) {
      kind = INTRINSIC_KINDS[tag];
      if (!kind) block(opening, "unmapped-element", `<${tag}> has no native mapping`);
    } else if (opening.name.type === "JSXNamespacedName") {
      block(opening, "unmapped-element", `<${tag}> has no native mapping`);
    } else {
      const root = tag.split(".")[0]!;
      const binding = imported.get(root);
      if (binding) {
        const member = tag.includes(".")
          ? binding.name === "*"
            ? tag.split(".")[1]!
            : ""
          : binding.name;
        kind = MAPPED_COMPONENTS[binding.source]?.[member];
        if (!kind) {
          const fromApp = /^(?:\.|\/|@\/|~|#)/.test(binding.source);
          counted = !fromApp;
          // A package component maps only through a portable package; others are blocked by
          // the import table.
          kind =
            fromApp || PORTABLE_PACKAGES.has(packageName(binding.source)) ? "Component" : undefined;
        }
      } else if (topLevel.has(root)) {
        kind = "Component";
        counted = false;
      } else {
        block(
          opening,
          "dynamic-component",
          `<${tag}> is a value the analyzer cannot resolve to a component`,
        );
      }
    }
    if (counted) {
      facts.elements.total += 1;
      if (kind) facts.elements.mapped += 1;
      if (kind && kind !== "Component" && kind !== "Fragment") {
        facts.elements.byKind[kind] = (facts.elements.byKind[kind] ?? 0) + 1;
      }
    }

    const node: FarmUiNode = { kind: kind ?? "View", tag };
    const props: Record<string, string | number | boolean> = {};
    const style: string[] = [];
    const events: string[] = [];
    for (const attribute of opening.attributes as Node[]) {
      if (attribute.type === "JSXSpreadAttribute") {
        if (isIntrinsic)
          block(attribute, "spread-props", `spread props on <${tag}> cannot be checked`);
        continue;
      }
      const name = attributeName(attribute);
      const value = attribute.value as Node | null;
      if (name === "key") continue;
      if (name === "dangerouslySetInnerHTML") {
        block(attribute, "dangerously-set-inner-html", "dangerouslySetInnerHTML");
        continue;
      }
      if (name === "contentEditable") {
        block(attribute, "content-editable", "contentEditable");
        continue;
      }
      if (name === "ref" && isIntrinsic) {
        block(attribute, "dom-ref", `a ref on <${tag}> reaches the DOM`);
        continue;
      }
      if ((name === "action" || name === "formAction") && isIntrinsic) {
        block(attribute, "form-action", `${name} on <${tag}>`);
        continue;
      }
      if (/^on[A-Z]/.test(name)) {
        if (isIntrinsic && kind && !MAPPED_EVENTS[kind as FarmUiNodeKind]?.has(name)) {
          block(attribute, "dom-event", `${name} on <${tag}> has no native event`);
        }
        events.push(name);
        continue;
      }
      if (name === "className" || name === "class") {
        const classes = staticString(value);
        if (classes === undefined) {
          block(attribute, "runtime-class-name", `<${tag}> builds its class names at runtime`);
          continue;
        }
        for (const token of classes.split(/\s+/).filter(Boolean)) {
          const problem = classifyClass(token);
          if (problem) block(attribute, "class-name", problem);
          else style.push(token);
        }
        continue;
      }
      if (name === "style") {
        const expression = value?.type === "JSXExpressionContainer" ? value.expression : null;
        if (!expression || expression.type !== "ObjectExpression") {
          block(attribute, "runtime-style", `<${tag}> style is not an object literal`);
          continue;
        }
        for (const property of expression.properties as Node[]) {
          if (property.type !== "Property" || property.computed) {
            block(property, "runtime-style", `<${tag}> style has a spread or computed key`);
            continue;
          }
          const key = property.key.name ?? property.key.value;
          if (!STYLE_PROPERTIES.has(key)) {
            block(property, "style", `style.${key} has no native mapping`);
            continue;
          }
          const literal = staticString(property.value);
          if (literal !== undefined) {
            if (STYLE_ENUMS[key] && !STYLE_ENUMS[key].has(literal)) {
              block(property, "style", `style.${key} "${literal}" has no native mapping`);
              continue;
            }
            if (STYLE_VALUE_BLOCK.test(literal)) {
              block(
                property,
                "style",
                `style.${key} "${literal}" uses a CSS-only unit or function`,
              );
              continue;
            }
          } else if (STYLE_ENUMS[key] && property.value.type !== "Literal") {
            block(property, "style", `style.${key} is computed at runtime`);
            continue;
          }
          style.push(`style.${key}`);
        }
        continue;
      }
      if (tag === "input" && name === "type") {
        const type = staticString(value);
        if (type === undefined || !INPUT_TYPES.has(type)) {
          block(
            attribute,
            "unmapped-element",
            `<input type="${type ?? "{expr}"}"> has no native mapping`,
          );
        }
      }
      const literal = value === null ? true : staticString(value);
      if (literal !== undefined) props[name] = literal;
      else if (
        value?.type === "JSXExpressionContainer" &&
        value.expression.type === "Literal" &&
        (typeof value.expression.value === "number" || typeof value.expression.value === "boolean")
      ) {
        props[name] = value.expression.value;
      } else props[name] = "{expr}";
    }
    if (
      kind === "TextInput" &&
      events.some((event) => event === "onChange" || event === "onInput")
    ) {
      wins.add("input");
    }
    if (Object.keys(props).length > 0) node.props = props;
    if (style.length > 0) node.style = style;
    if (events.length > 0) node.events = events;
    return node;
  };

  const append = (parent: FarmUiNode | undefined, child: FarmUiNode) => {
    if (!parent) return;
    (parent.children ??= []).push(child);
  };
  const visit = (node: Node | null | undefined, parent?: FarmUiNode): FarmUiNode | undefined => {
    if (!node || typeof node !== "object") return undefined;
    switch (node.type) {
      case "ImportDeclaration":
        return undefined;
      case "JSXElement": {
        const ui = classifyElement(node);
        for (const attribute of node.openingElement.attributes as Node[]) {
          visit(attribute.type === "JSXSpreadAttribute" ? attribute.argument : attribute.value);
        }
        visitChildren(node.children, ui);
        append(parent, ui);
        return ui;
      }
      case "JSXFragment": {
        const ui: FarmUiNode = { kind: "Fragment", tag: "" };
        visitChildren(node.children, ui);
        append(parent, ui);
        return ui;
      }
      case "JSXText": {
        const text = node.value.replace(/\s+/g, " ").trim();
        if (text && parent) parent.text = parent.text ? `${parent.text} ${text}` : text;
        return undefined;
      }
      case "JSXExpressionContainer":
        visit(node.expression, parent);
        return undefined;
      case "Identifier":
        if (BROWSER_GLOBALS.has(node.name)) globalCandidates.push(node);
        return undefined;
      case "MemberExpression":
        visit(node.object, parent);
        if (node.computed) visit(node.property, parent);
        return undefined;
      case "Property":
      case "PropertyDefinition":
      case "MethodDefinition":
        if (node.computed) visit(node.key, parent);
        visit(node.value, parent);
        return undefined;
      case "LabeledStatement":
        visit(node.body, parent);
        return undefined;
      case "BreakStatement":
      case "ContinueStatement":
        return undefined;
      case "VariableDeclarator":
        collectPatternNames(node.id, declared);
        visit(node.init, parent);
        // Defaults in patterns can read globals.
        visitPatternDefaults(node.id, parent);
        return undefined;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.id) declared.add(node.id.name);
        for (const param of node.params as Node[]) {
          collectPatternNames(param, declared);
          visitPatternDefaults(param, parent);
        }
        visit(node.body, parent);
        return undefined;
      case "ClassDeclaration":
      case "ClassExpression":
        if (node.id) declared.add(node.id.name);
        visit(node.superClass, parent);
        visit(node.body, parent);
        return undefined;
      case "CatchClause":
        collectPatternNames(node.param, declared);
        visit(node.body, parent);
        return undefined;
      case "CallExpression": {
        const callee = node.callee as Node;
        const calleeName =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" && !callee.computed
              ? callee.property.name
              : undefined;
        if (calleeName === "useLayoutEffect" || calleeName === "useInsertionEffect") {
          block(node, "layout-effect", `${calleeName} reads layout from the DOM`);
        }
        if (calleeName === "createElement" || calleeName === "cloneElement") {
          // Only JSX is classified; an element built by a call could be anything.
          block(
            node,
            "create-element",
            `${calleeName}() builds elements the analyzer cannot check`,
          );
        }
        if (calleeName === "setInterval") wins.add("timer");
        if (callee.type === "Identifier" && SERVER_FN_FACTORIES.has(callee.name)) {
          const binding = imported.get(callee.name);
          if (binding?.source.startsWith("@farm.js/core")) callsServerFactory = true;
        }
        if (calleeName === "map" && callee.type === "MemberExpression" && parent) {
          // `items.map(item => <Row />)` renders a list.
          const before = facts.elements.total;
          visit(callee.object, parent);
          for (const argument of node.arguments as Node[]) visit(argument, parent);
          if (facts.elements.total > before) wins.add("list");
          return undefined;
        }
        visit(callee, parent);
        for (const argument of node.arguments as Node[]) visit(argument, parent);
        return undefined;
      }
      case "ImportExpression": {
        const specifier = staticString(node.source);
        facts.imports.push({
          source: specifier ?? "",
          ...locate(starts, node.start),
          names: ["*"],
          dynamic: true,
          ...(specifier === undefined ? { computed: true } : {}),
        });
        if (specifier === undefined) visit(node.source, parent);
        return undefined;
      }
    }
    if (node.type.startsWith("TS")) {
      // Types never run; type assertions wrap an expression that does.
      if (node.expression) visit(node.expression, parent);
      return undefined;
    }
    for (const key in node) {
      if (SKIP_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) if (item && typeof item.type === "string") visit(item, parent);
      } else if (value && typeof value.type === "string") {
        visit(value, parent);
      }
    }
    return undefined;
  };
  const visitChildren = (children: Node[], parent: FarmUiNode) => {
    parent.children ??= [];
    for (const child of children) visit(child, parent);
    if (parent.children.length === 0) delete parent.children;
  };
  const visitPatternDefaults = (pattern: Node | null | undefined, parent?: FarmUiNode) => {
    if (!pattern) return;
    if (pattern.type === "AssignmentPattern") visit(pattern.right, parent);
    else if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties) {
        visitPatternDefaults(
          property.type === "RestElement" ? property.argument : property.value,
          parent,
        );
      }
    } else if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) visitPatternDefaults(element, parent);
    }
  };

  // Components: top-level functions (and arrow consts) are IR roots; JSX inside them hangs off
  // a holder node so nested returns all land in the component's tree.
  for (const statement of program.body as Node[]) {
    if (statement.type === "ImportDeclaration") continue;
    const isDefault = statement.type === "ExportDefaultDeclaration";
    const declaration =
      statement.type === "ExportNamedDeclaration" || isDefault ? statement.declaration : statement;
    const roots: Array<[string, Node]> = [];
    if (
      declaration?.type === "FunctionDeclaration" ||
      (isDefault && /Function/.test(declaration?.type ?? ""))
    ) {
      roots.push([isDefault ? "default" : declaration.id.name, declaration]);
    } else if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations as Node[]) {
        if (declarator.id.type === "Identifier" && /Function/.test(declarator.init?.type ?? "")) {
          roots.push([declarator.id.name, declarator]);
        }
      }
    }
    if (roots.length === 0) {
      visit(statement);
      continue;
    }
    for (const [name, root] of roots) {
      const holder: FarmUiNode = { kind: "Fragment", tag: name, children: [] };
      visit(root, holder);
      if (holder.children!.length > 0) {
        facts.components[name] = holder.children!.length === 1 ? holder.children![0]! : holder;
      }
    }
    if (isDefault && declaration?.type === "Identifier") {
      // `export default Page` names a top-level component.
      facts.components.default = { kind: "Component", tag: declaration.name };
    }
  }
  blockGlobalsLater();
  if (defaultName && asyncFunctions.has(defaultName)) facts.asyncDefault = true;
  if (callsServerFactory) facts.serverBoundary = true;
  facts.wins = [...wins].sort();
  facts.blockers.sort((left, right) => left.line - right.line || left.column - right.column);
  return facts;
}

type ParseSync = (
  file: string,
  source: string,
  options: { lang: "ts" | "tsx" | "jsx" },
) => { program: unknown; errors: Array<{ message: string; labels?: Array<{ start: number }> }> };

// ---------------------------------------------------------------------------------------------
// Resolution

interface ResolvedImport {
  fact: ImportFact;
  /** Absolute app module path, for app-local script imports. */
  file?: string;
  blocker?: LocalBlocker;
}

interface AliasEntry {
  prefix: string;
  targets: string[];
}

/** `@/` (Farm's source alias) and tsconfig `compilerOptions.paths`. */
function readAliases(root: string, srcDir: string): AliasEntry[] {
  const aliases: AliasEntry[] = [{ prefix: "@/", targets: [path.join(root, srcDir) + path.sep] }];
  try {
    const raw = readFileSync(path.join(root, "tsconfig.json"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    const options = JSON.parse(raw).compilerOptions ?? {};
    const base = path.resolve(root, options.baseUrl ?? ".");
    for (const [key, values] of Object.entries<string[]>(options.paths ?? {})) {
      const prefix = key.replace(/\*$/, "");
      aliases.push({
        prefix,
        targets: values.map((value) => path.join(base, value.replace(/\*$/, ""))),
      });
    }
  } catch {
    // No tsconfig, or not JSON: Farm's alias still applies.
  }
  return aliases.sort((left, right) => right.prefix.length - left.prefix.length);
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function resolveFile(base: string): string | undefined {
  if (isFile(base)) return base;
  for (const extension of SCRIPT_EXTENSIONS) if (isFile(base + extension)) return base + extension;
  // TypeScript ESM style: `./x.js` names `./x.ts`.
  const withoutJs = base.replace(/\.(?:js|jsx|mjs)$/, "");
  if (withoutJs !== base) {
    for (const extension of [".ts", ".tsx"])
      if (isFile(withoutJs + extension)) return withoutJs + extension;
  }
  for (const extension of SCRIPT_EXTENSIONS) {
    const index = path.join(base, `index${extension}`);
    if (isFile(index)) return index;
  }
  return undefined;
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function classifyPackage(fact: ImportFact, serverBoundary: boolean): LocalBlocker | undefined {
  const at = { line: fact.line, column: fact.column };
  const specifier = fact.source;
  if (specifier.startsWith("node:") || NODE_BUILTINS.has(packageName(specifier))) {
    return serverBoundary
      ? undefined
      : { ...at, rule: "node-builtin", message: `import "${specifier}" is a Node.js API` };
  }
  if (specifier.startsWith("@farm.js/core")) {
    const portable = CORE_PORTABLE[specifier];
    const unmapped = fact.names.filter((name) => !portable?.has(name));
    if (unmapped.length > 0 || !portable) {
      return {
        ...at,
        rule: "unmapped-import",
        message: `${unmapped.join(", ") || "import"} from "${specifier}" has no native mapping`,
      };
    }
    return undefined;
  }
  const name = packageName(specifier);
  if (name === "react") {
    return specifier === "react" ||
      specifier === "react/jsx-runtime" ||
      specifier === "react/jsx-dev-runtime"
      ? undefined
      : { ...at, rule: "unknown-package", message: `import "${specifier}" has no native mapping` };
  }
  if (PORTABLE_PACKAGES.has(name)) return undefined;
  if (
    DOM_PACKAGES.some((entry) =>
      entry.endsWith("/") || entry.endsWith("-") ? specifier.startsWith(entry) : name === entry,
    )
  ) {
    return { ...at, rule: "dom-package", message: `import "${specifier}" renders to the DOM` };
  }
  return {
    ...at,
    rule: "unknown-package",
    message: `import "${specifier}" has no native mapping`,
  };
}

const NODE_BUILTINS = new Set(
  (
    "assert buffer child_process cluster crypto dgram dns events fs http http2 https module net " +
    "os path perf_hooks process querystring readline stream string_decoder timers tls tty url " +
    "util v8 vm worker_threads zlib"
  ).split(" "),
);

// ---------------------------------------------------------------------------------------------
// Run

interface CacheFile {
  version: string;
  modules: Record<string, ModuleFacts>;
}

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

const LAYOUT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

/**
 * The layouts that wrap a page on a native screen, outermost first: each segment's `layout.tsx`,
 * unless a `layout.native.tsx` replaces it there.
 */
function layoutChain(
  appDir: string,
  pageFile: string,
  layoutByDir: Map<string, string | null>,
): string[] {
  const layouts: string[] = [];
  let dir = path.dirname(pageFile);
  for (;;) {
    let layout = layoutByDir.get(dir);
    if (layout === undefined) {
      const replaced = LAYOUT_EXTENSIONS.some((extension) =>
        existsSync(path.join(dir, `layout.native${extension}`)),
      );
      layout = replaced
        ? null
        : (LAYOUT_EXTENSIONS.map((extension) => path.join(dir, `layout${extension}`)).find((file) =>
            existsSync(file),
          ) ?? null);
      layoutByDir.set(dir, layout);
    }
    if (layout) layouts.unshift(layout);
    if (path.resolve(dir) === path.resolve(appDir) || path.dirname(dir) === dir) break;
    dir = path.dirname(dir);
  }
  return layouts;
}

export async function analyzeFarmMobileRoutes(
  options: FarmMobileAnalyzeOptions,
): Promise<FarmMobileAnalyzerResult> {
  const started = performance.now();
  const root = path.resolve(options.root);
  const srcDir = options.srcDir || "src";
  const aliases = readAliases(root, srcDir);
  const { parseSync } = (await import("rolldown/utils")) as unknown as { parseSync: ParseSync };

  let cache: CacheFile = { version: ANALYZER_VERSION, modules: {} };
  if (options.cacheFile) {
    try {
      const stored = JSON.parse(await readFile(options.cacheFile, "utf8")) as CacheFile;
      if (stored.version === ANALYZER_VERSION && stored.modules) cache = stored;
    } catch {
      // First run, or an unreadable cache: start empty.
    }
  }
  const used: Record<string, ModuleFacts> = {};
  let parsed = 0;
  let cached = 0;

  const facts = new Map<string, Promise<ModuleFacts>>();
  const resolved = new Map<string, ResolvedImport[]>();

  const loadFacts = (file: string): Promise<ModuleFacts> => {
    let pending = facts.get(file);
    if (!pending) {
      pending = readFile(file, "utf8").then((source) => {
        const hash = createHash("sha1")
          .update(file.endsWith(".tsx") ? "tsx\0" : file.endsWith(".ts") ? "ts\0" : "jsx\0")
          .update(source)
          .digest("hex");
        let result = cache.modules[hash];
        if (result) cached += 1;
        else {
          result = analyzeSource(file, source, parseSync);
          parsed += 1;
        }
        used[hash] = result;
        return result;
      });
      facts.set(file, pending);
    }
    return pending;
  };

  const resolveImport = (
    from: string,
    fact: ImportFact,
    moduleFacts: ModuleFacts,
  ): ResolvedImport => {
    const at = { line: fact.line, column: fact.column };
    if (fact.computed) {
      return {
        fact,
        blocker: {
          ...at,
          rule: "dynamic-import",
          message: "import() of a computed specifier cannot be followed",
        },
      };
    }
    const specifier = fact.source;
    let candidates: string[] | undefined;
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      candidates = [
        specifier.startsWith("/")
          ? path.join(root, specifier)
          : path.resolve(path.dirname(from), specifier),
      ];
    } else {
      const alias = aliases.find(
        (entry) =>
          specifier.startsWith(entry.prefix) || specifier === entry.prefix.replace(/\/$/, ""),
      );
      if (alias) {
        candidates = alias.targets.map((target) =>
          path.join(target, specifier.slice(alias.prefix.length)),
        );
      }
    }
    if (!candidates) {
      if (STYLE_FILE.test(specifier)) {
        return {
          fact,
          blocker: { ...at, rule: "css-import", message: `import "${specifier}" is a stylesheet` },
        };
      }
      const blocker = classifyPackage(fact, moduleFacts.serverBoundary);
      return blocker ? { fact, blocker } : { fact };
    }
    if (STYLE_FILE.test(specifier)) {
      return {
        fact,
        blocker: { ...at, rule: "css-import", message: `import "${specifier}" is a stylesheet` },
      };
    }
    if (ASSET_FILE.test(specifier)) return { fact };
    for (const candidate of candidates) {
      const file = resolveFile(candidate);
      if (file) {
        if (ASSET_FILE.test(file)) return { fact };
        if (STYLE_FILE.test(file)) {
          return {
            fact,
            blocker: {
              ...at,
              rule: "css-import",
              message: `import "${specifier}" is a stylesheet`,
            },
          };
        }
        if (!SCRIPT_EXTENSIONS.some((extension) => file.endsWith(extension))) {
          return {
            fact,
            blocker: {
              ...at,
              rule: "unresolved-import",
              message: `import "${specifier}" is not a script module`,
            },
          };
        }
        return { fact, file };
      }
    }
    return {
      fact,
      blocker: { ...at, rule: "unresolved-import", message: `import "${specifier}" was not found` },
    };
  };

  // Load every reachable app module once, reading files concurrently.
  const visitModule = async (file: string): Promise<void> => {
    if (resolved.has(file)) return;
    resolved.set(file, []);
    const moduleFacts = await loadFacts(file);
    const imports = moduleFacts.imports.map((fact) => resolveImport(file, fact, moduleFacts));
    resolved.set(file, imports);
    // A server function module is data: its imports never reach the client.
    if (moduleFacts.serverBoundary) return;
    await Promise.all(imports.map((entry) => (entry.file ? visitModule(entry.file) : undefined)));
  };

  const appDir = path.join(root, srcDir, "app");
  const entries = new Map<string, { page?: string; layouts: string[] }>();
  const layoutByDir = new Map<string, string | null>();
  for (const route of options.routes) {
    const page = options.pageFiles.get(route);
    entries.set(route, { page, layouts: page ? layoutChain(appDir, page, layoutByDir) : [] });
  }
  const scripts = new Set<string>();
  for (const { page, layouts } of entries.values()) {
    for (const file of [page, ...layouts]) {
      if (file && SCRIPT_EXTENSIONS.some((extension) => file.endsWith(extension)))
        scripts.add(file);
    }
  }
  await Promise.all([...scripts].map(visitModule));

  const settled = new Map<string, ModuleFacts>();
  for (const [file, pending] of facts) settled.set(file, await pending);

  const routes: Record<string, FarmMobileRouteAnalysis> = {};
  for (const [route, { page, layouts }] of entries) {
    const blockers: FarmMobileBlocker[] = [];
    const wins = new Set<FarmMobileWin>();
    const elements: FarmMobileElementCounts = { total: 0, mapped: 0, byKind: {} };
    const seen = new Set<string>();
    const ir: FarmMobileRouteIR = { root: "", components: {} };

    const walk = (file: string, entry: boolean) => {
      if (seen.has(file)) return;
      seen.add(file);
      const moduleFacts = settled.get(file)!;
      const label = relative(root, file);
      if (entry && options.serverComponents && !moduleFacts.useClient) {
        blockers.push({
          file: label,
          line: 1,
          column: 1,
          rule: "server-component",
          message: 'a server component (no "use client") renders on the server',
        });
      }
      if (entry && moduleFacts.asyncDefault) {
        blockers.push({
          file: label,
          line: 1,
          column: 1,
          rule: "async-component",
          message: "an async component renders on the server",
        });
      }
      if (moduleFacts.serverBoundary && !entry) return;
      for (const blocker of moduleFacts.blockers) blockers.push({ file: label, ...blocker });
      for (const win of moduleFacts.wins) wins.add(win);
      elements.total += moduleFacts.elements.total;
      elements.mapped += moduleFacts.elements.mapped;
      for (const [kind, count] of Object.entries(moduleFacts.elements.byKind)) {
        elements.byKind[kind as FarmUiNodeKind] =
          (elements.byKind[kind as FarmUiNodeKind] ?? 0) + count!;
      }
      for (const [name, node] of Object.entries(moduleFacts.components)) {
        ir.components[`${label}#${name}`] = node;
      }
      for (const entryImport of resolved.get(file) ?? []) {
        if (entryImport.blocker) blockers.push({ file: label, ...entryImport.blocker });
        if (entryImport.file) walk(entryImport.file, false);
      }
    };

    if (!page) {
      blockers.push({
        file: "",
        line: 0,
        column: 0,
        rule: "programmatic-route",
        message: "a programmatic route has no page file to analyze",
      });
    } else if (/\.(?:md|mdx)$/.test(page)) {
      blockers.push({
        file: relative(root, page),
        line: 1,
        column: 1,
        rule: "markdown-page",
        message: "a Markdown page renders HTML from Markdown",
      });
    } else {
      walk(page, true);
      ir.root = `${relative(root, page)}#default`;
    }
    for (const layout of layouts) walk(layout, true);

    const portable = blockers.length === 0;
    const sortedWins = [...wins].sort();
    const analysis: FarmMobileRouteAnalysis = {
      route,
      decision: portable && sortedWins.length > 0 ? "port" : "web",
      portable,
      blockers,
      wins: sortedWins,
      elements,
      portablePercent:
        elements.total === 0
          ? portable
            ? 100
            : 0
          : Math.round((elements.mapped / elements.total) * 100),
      modules: seen.size,
    };
    if (portable) {
      analysis.ir = ir;
      analysis.irBytes = Buffer.byteLength(JSON.stringify(ir));
    }
    routes[route] = analysis;
  }

  if (options.cacheFile) {
    await mkdir(path.dirname(options.cacheFile), { recursive: true });
    await writeFile(
      options.cacheFile,
      JSON.stringify({ version: ANALYZER_VERSION, modules: used }),
    );
  }
  return {
    routes,
    stats: { modules: facts.size, parsed, cached, ms: Math.round(performance.now() - started) },
  };
}
