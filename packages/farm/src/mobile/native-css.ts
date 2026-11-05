/**
 * An app's own CSS for the native tier: the rules a page's elements match, as a browser would
 * cascade them, turned into native style. It reads the stylesheet the browser gets, so CSS modules,
 * PostCSS, and preprocessors are already applied.
 *
 * Supported: type, class, id, and attribute selectors, compounds, descendant, child, and sibling
 * combinators, `:first-child` and `:last-child`; `:root` custom properties with `var()`, also under
 * `@media (prefers-color-scheme: dark)`; specificity and source order. Interaction states
 * (`:hover`, `:focus`, ...) never match a static screen. Rules in `@layer` (Tailwind's own) are
 * left to the Tailwind table. Anything else that could match an element (another `@media`, an
 * unknown pseudo-class, a declaration with no native style) is reported, and the shell shows the
 * web screen.
 */
import {
  resolveFarmNativeDeclaration,
  splitFarmCssDeclarations,
  type FarmNativeStyle,
} from "./native-style";

interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  attributes: Array<{ name: string; value?: string }>;
  /** `first-child` or `last-child`. */
  positions: string[];
}

interface Selector {
  /** Right to left: the subject first, then each ancestor or sibling step. */
  steps: Array<{ compound: Compound; combinator?: " " | ">" | "+" | "~" }>;
  specificity: number;
}

interface Rule {
  selector: Selector;
  /** The selector as written, for reports. */
  text: string;
  declarations: Array<[string, string]>;
  dark?: boolean;
  /** Source order. */
  order: number;
}

/** A selector the native tier cannot evaluate, kept so elements it might match are reported. */
interface UnknownRule {
  /** The subject compound's classes and tag, to find elements it could match. */
  classes: string[];
  tag?: string;
  text: string;
}

export interface FarmNativeStylesheet {
  rules: Rule[];
  unknown: UnknownRule[];
  vars: { light: Record<string, string>; dark: Record<string, string> };
  /** Classes a layered rule (Tailwind's) styles: the Tailwind table owns them. */
  layered: Set<string>;
}

/** What the cascade needs of an element: its tag, attributes, and neighbors. */
export interface FarmNativeCssElement {
  tag: string;
  attributes: Record<string, string>;
  parent?: FarmNativeCssElement;
  /** The element before it among its parent's element children. */
  previous?: FarmNativeCssElement;
  /** No element after it among its parent's element children. */
  last?: boolean;
}

const IGNORED_PSEUDO =
  /^:(?:hover|focus|focus-visible|focus-within|active|visited|target|checked|placeholder-shown|disabled|enabled|empty)$/;
const DROPPED_AT_RULES =
  /^@(?:font-face|keyframes|-webkit-keyframes|property|page|import|charset|namespace|tailwind|config|plugin|source|custom-variant|variant|utility|theme)\b/;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Split `a, b` outside parentheses and brackets. */
function splitList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/** Parse one compound, or `undefined` for one the native tier cannot evaluate. */
function parseCompound(text: string): Compound | null | undefined {
  const compound: Compound = { classes: [], attributes: [], positions: [] };
  const token =
    /([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~|^$*]?=)["']?([^"'\]]*)["']?)?\]|(::?[\w-]+)(\([^)]*\))?/gy;
  let match: RegExpExecArray | null;
  let index = 0;
  while (index < text.length) {
    token.lastIndex = index;
    match = token.exec(text);
    if (!match) return undefined;
    index = token.lastIndex;
    if (match[1]) {
      if (match[1] !== "*") compound.tag = match[1].toLowerCase();
    } else if (match[2]) compound.id = match[2];
    else if (match[3]) compound.classes.push(match[3]);
    else if (match[4]) {
      if (match[5] && match[5] !== "=") return undefined;
      compound.attributes.push({ name: match[4].toLowerCase(), value: match[6] });
    } else if (match[7]) {
      if (match[8]) return undefined;
      if (match[7] === ":first-child" || match[7] === ":last-child") {
        compound.positions.push(match[7].slice(1));
      } else if (match[7] === ":root") compound.tag = "html";
      else if (IGNORED_PSEUDO.test(match[7])) return null;
      else return undefined;
    }
  }
  return compound;
}

/**
 * Parse a selector. `null`: it never matches a static screen (`:hover`). `undefined`: the native
 * tier cannot evaluate it.
 */
function parseSelector(text: string): Selector | null | undefined {
  const steps: Selector["steps"] = [];
  let specificity = 0;
  const parts = text
    .replace(/\s*([>+~])\s*/g, " $1 ")
    .trim()
    .split(/\s+/);
  let combinator: " " | ">" | "+" | "~" | undefined;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!;
    if (part === ">" || part === "+" || part === "~") {
      combinator = part;
      continue;
    }
    const compound = parseCompound(part);
    if (compound === null) return null;
    if (compound === undefined) return undefined;
    if (steps.length > 0) steps[steps.length - 1]!.combinator = combinator ?? " ";
    steps.push({ compound });
    combinator = undefined;
    specificity +=
      (compound.id ? 10000 : 0) +
      (compound.classes.length + compound.attributes.length + compound.positions.length) * 100 +
      (compound.tag ? 1 : 0);
  }
  return steps.length > 0 ? { steps, specificity } : undefined;
}

/** Parse the stylesheet's top-level rules and the blocks inside supported at-rules. */
export function parseFarmNativeStylesheet(css: string): FarmNativeStylesheet {
  const sheet: FarmNativeStylesheet = {
    rules: [],
    unknown: [],
    vars: { light: {}, dark: {} },
    layered: new Set(),
  };
  let order = 0;
  const walk = (
    text: string,
    context: { dark?: boolean; light?: boolean; layered?: boolean; unknownMedia?: string },
  ) => {
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf("{", index);
      const semicolon = text.indexOf(";", index);
      if (open < 0) break;
      if (semicolon >= 0 && semicolon < open) {
        // A statement at-rule, such as `@import`.
        index = semicolon + 1;
        continue;
      }
      const prelude = text.slice(index, open).trim();
      let depth = 1;
      let close = open + 1;
      while (close < text.length && depth > 0) {
        if (text[close] === "{") depth += 1;
        else if (text[close] === "}") depth -= 1;
        close += 1;
      }
      const body = text.slice(open + 1, close - 1);
      index = close;
      if (prelude.startsWith("@")) {
        if (DROPPED_AT_RULES.test(prelude)) continue;
        if (/^@layer\b/.test(prelude)) {
          walk(body, { ...context, layered: true });
        } else if (/^@media\b/.test(prelude)) {
          const query = prelude.slice(6).trim();
          if (/^\(\s*prefers-color-scheme:\s*dark\s*\)$/.test(query))
            walk(body, { ...context, dark: true });
          else if (/^\(\s*prefers-color-scheme:\s*light\s*\)$/.test(query))
            walk(body, { ...context, light: true });
          else walk(body, { ...context, unknownMedia: prelude });
        } else if (/^@supports\b/.test(prelude)) {
          walk(body, context);
        } else {
          walk(body, { ...context, unknownMedia: prelude });
        }
        continue;
      }
      const declarations = splitFarmCssDeclarations(body);
      // `@apply` is the build's to expand; the source alone does not say what it sets.
      const applies = /@apply\b/.test(body);
      for (const text of splitList(prelude)) {
        const selector = parseSelector(text);
        if (selector === null) continue;
        const subject = selector?.steps[0]!.compound;
        if (context.layered) {
          for (const name of subject?.classes ?? []) sheet.layered.add(name);
          continue;
        }
        // Custom properties on :root (and html) are the variables `var()` reads.
        if (
          selector &&
          selector.steps.length === 1 &&
          subject?.tag === "html" &&
          !subject.classes.length
        ) {
          for (const [property, value] of declarations) {
            if (property.startsWith("--")) {
              (context.dark ? sheet.vars.dark : sheet.vars.light)[property] = value;
            }
          }
        }
        if (!selector || context.unknownMedia || applies) {
          const fallback = /(?:^|[\s>+~])([a-zA-Z][\w-]*)?((?:[.#:[][^\s>+~]*)?)$/.exec(text);
          sheet.unknown.push({
            classes: [...(fallback?.[2] ?? "").matchAll(/\.([\w-]+)/g)].map((match) => match[1]!),
            tag: fallback?.[1]?.toLowerCase(),
            text: context.unknownMedia
              ? `${context.unknownMedia} ${text}`
              : applies
                ? `${text} { @apply }`
                : text,
          });
          continue;
        }
        if (context.light) continue;
        const own = declarations.filter(([property]) => !property.startsWith("--"));
        if (own.length > 0) {
          sheet.rules.push({
            selector,
            text,
            declarations: own,
            dark: context.dark,
            order: order++,
          });
        }
      }
    }
  };
  walk(stripComments(css), {});
  return sheet;
}

function classesOf(element: FarmNativeCssElement): string[] {
  return (element.attributes.class ?? "").split(/\s+/).filter(Boolean);
}

function matchesCompound(compound: Compound, element: FarmNativeCssElement): boolean {
  if (compound.tag && compound.tag !== element.tag) return false;
  if (compound.id && element.attributes.id !== compound.id) return false;
  if (compound.classes.length > 0) {
    const classes = classesOf(element);
    if (!compound.classes.every((name) => classes.includes(name))) return false;
  }
  for (const attribute of compound.attributes) {
    // The shell marks <html data-farm-shell>; a native screen is inside the shell too.
    const value =
      attribute.name === "data-farm-shell" && element.tag === "html"
        ? (element.attributes[attribute.name] ?? "android")
        : element.attributes[attribute.name];
    if (value === undefined) return false;
    if (attribute.value !== undefined && value !== attribute.value) return false;
  }
  for (const position of compound.positions) {
    if (position === "first-child" && element.previous) return false;
    if (position === "last-child" && !element.last) return false;
  }
  return true;
}

function matches(selector: Selector, element: FarmNativeCssElement): boolean {
  const step = (index: number, target: FarmNativeCssElement | undefined): boolean => {
    if (!target) return false;
    const { compound, combinator } = selector.steps[index]!;
    if (!matchesCompound(compound, target)) return false;
    if (index === selector.steps.length - 1) return true;
    switch (combinator) {
      case ">":
        return step(index + 1, target.parent);
      case "+":
        return step(index + 1, target.previous);
      case "~":
        for (let sibling = target.previous; sibling; sibling = sibling.previous) {
          if (step(index + 1, sibling)) return true;
        }
        return false;
      default:
        for (let ancestor = target.parent; ancestor; ancestor = ancestor.parent) {
          if (step(index + 1, ancestor)) return true;
        }
        return false;
    }
  };
  return step(0, element);
}

/** Replace `var(--x, fallback)` with the stylesheet's value, or `undefined` if one is missing. */
function substitute(value: string, vars: Record<string, string>, depth = 0): string | undefined {
  if (!value.includes("var(")) return value;
  if (depth > 8) return undefined;
  let missing = false;
  const replaced = value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g,
    (_, name: string, fallback?: string) => {
      const resolved = vars[name] ?? fallback?.trim();
      if (resolved === undefined) {
        missing = true;
        return "";
      }
      return resolved;
    },
  );
  return missing ? undefined : substitute(replaced, vars, depth + 1);
}

/**
 * The style the stylesheets give an element, light and dark, and what could not be expressed.
 * Declarations apply in cascade order: specificity, then source order.
 */
export function cascadeFarmNativeStylesheets(
  sheets: readonly FarmNativeStylesheet[],
  element: FarmNativeCssElement,
): { style: FarmNativeStyle; dark: FarmNativeStyle; unsupported: string[]; layered: string[] } {
  const style: FarmNativeStyle = {};
  const dark: FarmNativeStyle = {};
  const unsupported: string[] = [];
  const classes = classesOf(element);
  const matched: Array<{ rule: Rule; sheet: FarmNativeStylesheet; index: number }> = [];
  sheets.forEach((sheet, index) => {
    for (const rule of sheet.rules) {
      if (matches(rule.selector, element)) matched.push({ rule, sheet, index });
    }
    for (const unknown of sheet.unknown) {
      const touches =
        unknown.classes.some((name) => classes.includes(name)) ||
        (unknown.classes.length === 0 && unknown.tag === element.tag);
      if (touches) unsupported.push(`selector "${unknown.text}"`);
    }
  });
  matched.sort(
    (left, right) =>
      left.rule.selector.specificity - right.rule.selector.specificity ||
      left.index - right.index ||
      left.rule.order - right.rule.order,
  );
  for (const { rule, sheet } of matched) {
    for (const [property, raw] of rule.declarations) {
      // A light rule applies in both themes unless a dark rule overrides it; each theme reads its
      // own variables.
      const themes = rule.dark ? [dark] : [style, dark];
      for (const target of themes) {
        const vars =
          target === dark ? { ...sheet.vars.light, ...sheet.vars.dark } : sheet.vars.light;
        const value = substitute(raw, vars);
        const resolved =
          value === undefined
            ? undefined
            : resolveFarmNativeDeclaration(property, value.toLowerCase().trim());
        if (resolved === undefined) {
          const message = `${property}: ${raw}`;
          if (!unsupported.includes(message)) unsupported.push(message);
          break;
        }
        if (resolved) Object.assign(target, resolved);
      }
    }
  }
  // Keep only what the dark theme changes.
  for (const key of Object.keys(dark)) {
    if (dark[key] === style[key]) delete dark[key];
  }
  const layered = classes.filter((name) => sheets.some((sheet) => sheet.layered.has(name)));
  return { style, dark, unsupported, layered };
}

/**
 * For the analyzer, which sees source CSS but no rendered page: whether any rule styles a class
 * (or an element type, `tag`), and what in those rules the native tier cannot express.
 */
export function inspectFarmNativeStylesheets(
  sheets: readonly FarmNativeStylesheet[],
  target: { class: string } | { tag: string },
): { styled: boolean; problems: string[] } {
  const problems: string[] = [];
  let styled = false;
  const touches = (compound: Compound, subject: boolean) =>
    "class" in target
      ? compound.classes.includes(target.class)
      : subject && compound.tag === target.tag && compound.classes.length === 0;
  for (const sheet of sheets) {
    for (const rule of sheet.rules) {
      if (!rule.selector.steps.some((step, index) => touches(step.compound, index === 0))) continue;
      styled = true;
      for (const [property, raw] of rule.declarations) {
        for (const vars of [sheet.vars.light, { ...sheet.vars.light, ...sheet.vars.dark }]) {
          const value = substitute(raw, vars);
          if (
            value === undefined ||
            resolveFarmNativeDeclaration(property, value.toLowerCase().trim()) === undefined
          ) {
            const message = `"${rule.text} { ${property}: ${raw} }" has no native-tier style`;
            if (!problems.includes(message)) problems.push(message);
            break;
          }
        }
      }
    }
    for (const unknown of sheet.unknown) {
      const hit =
        "class" in target
          ? unknown.classes.includes(target.class)
          : unknown.classes.length === 0 && unknown.tag === target.tag;
      if (hit) {
        styled = true;
        problems.push(`"${unknown.text}" is CSS the native tier cannot apply`);
      }
    }
  }
  return { styled, problems };
}

/**
 * For a React Native port, which knows each element's tag but not where it renders: the style
 * the rules for the tag alone give it (type, universal, `:root`), light and dark, and every rule
 * that could match it but depends on more than its tag, which a port cannot decide.
 *
 * Port elements carry no classes, so a rule that needs a class on the element never matches, and
 * one that needs a class on an ancestor or sibling matches only when a layout around the page
 * renders that class (`contextClasses`).
 */
export function cascadeFarmNativeStylesheetsForTag(
  sheets: readonly FarmNativeStylesheet[],
  tag: string,
  contextClasses: ReadonlySet<string> = new Set(),
): {
  style: FarmNativeStyle;
  dark: FarmNativeStyle;
  /**
   * Text styles a rule sets to `inherit`, such as `font: inherit` on `input`: form controls take
   * no font or color from their parent otherwise.
   */
  inherit: string[];
  problems: string[];
} {
  const problems: string[] = [];
  const inherit = new Set<string>();
  const problem = (message: string) => {
    if (!problems.includes(message)) problems.push(message);
  };
  for (const sheet of sheets) {
    for (const rule of sheet.rules) {
      const [subject, ...context] = rule.selector.steps;
      const compound = subject!.compound;
      if ((compound.tag && compound.tag !== tag) || compound.classes.length > 0) continue;
      const unreachable = context.some(
        (step) =>
          step.compound.classes.length > 0 &&
          step.compound.classes.some((name) => !contextClasses.has(name)),
      );
      if (unreachable) continue;
      const shellOnly =
        tag === "html" &&
        compound.attributes.every((attribute) => attribute.name === "data-farm-shell");
      if (
        context.length > 0 ||
        compound.id ||
        compound.positions.length > 0 ||
        (compound.attributes.length > 0 && !shellOnly)
      ) {
        problem(`"${rule.text}" depends on where <${tag}> renders`);
        continue;
      }
      for (const [property, value] of rule.declarations) {
        if (value.trim().toLowerCase() !== "inherit") continue;
        for (const key of INHERITABLE[property] ?? []) inherit.add(key);
      }
    }
    for (const unknown of sheet.unknown) {
      if (unknown.classes.length === 0 && (!unknown.tag || unknown.tag === tag)) {
        problem(`"${unknown.text}" is CSS a port cannot apply`);
      }
    }
  }
  const { style, dark, unsupported } = cascadeFarmNativeStylesheets(sheets, {
    tag,
    attributes: tag === "html" ? { "data-farm-shell": "" } : {},
  });
  for (const message of unsupported) problem(`<${tag}> ${message}`);
  return { style, dark, inherit: [...inherit].sort(), problems };
}

/** The native text styles each inheritable CSS property sets. */
const INHERITABLE: Record<string, string[]> = {
  font: ["fontFamily", "fontSize", "fontStyle", "fontWeight", "lineHeight"],
  "font-family": ["fontFamily"],
  "font-size": ["fontSize"],
  "font-style": ["fontStyle"],
  "font-weight": ["fontWeight"],
  "line-height": ["lineHeight"],
  "letter-spacing": ["letterSpacing"],
  color: ["color"],
  "text-align": ["textAlign"],
};
