type CspDirectiveValue = string | readonly string[] | boolean | null | undefined;

/** The shapes `security.csp` accepts, plus the resolved `{ value }` form. */
export type BotCspInput =
  | string
  | false
  | undefined
  | {
      policy?: string;
      directives?: Readonly<Record<string, CspDirectiveValue>>;
      value?: string;
      [option: string]: unknown;
    };

// A directive the policy leaves out falls back to these, in order (CSP Level 3).
const FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  "frame-src": ["child-src", "default-src"],
  "worker-src": ["child-src", "script-src", "default-src"],
  "script-src-elem": ["script-src", "default-src"],
  "script-src-attr": ["script-src", "default-src"],
  "style-src-elem": ["style-src", "default-src"],
  "style-src-attr": ["style-src", "default-src"],
};

function fallbacksFor(directive: string): readonly string[] {
  return FALLBACKS[directive] ?? (directive.endsWith("-src") ? ["default-src"] : []);
}

interface DirectiveAccess {
  get(name: string): string[] | undefined;
  set(name: string, sources: string[]): void;
}

/**
 * Add the widget's sources to an app's CSP, so turning on `security.csp` doesn't silently
 * block the widget. Directives the policy leaves unrestricted stay unrestricted.
 */
export function withBotCsp(
  csp: BotCspInput,
  sources: Readonly<Record<string, readonly string[]>>,
): BotCspInput {
  if (csp === undefined || csp === false) return csp;
  if (typeof csp === "string") return mergePolicy(csp, sources);
  if (typeof csp.policy === "string") return { ...csp, policy: mergePolicy(csp.policy, sources) };
  if (typeof csp.value === "string") return { ...csp, value: mergePolicy(csp.value, sources) };
  if (csp.directives && typeof csp.directives === "object") {
    return { ...csp, directives: mergeDirectives(csp.directives, sources) };
  }
  return csp;
}

function addSources(access: DirectiveAccess, sources: Readonly<Record<string, readonly string[]>>) {
  for (const [directive, needed] of Object.entries(sources)) {
    const targets = [directive];
    // `script-src-elem` and `style-src-elem` override the base directive for elements.
    if (access.get(`${directive}-elem`) !== undefined) targets.push(`${directive}-elem`);

    for (const target of targets) {
      let current = access.get(target);
      if (current === undefined) {
        for (const fallback of fallbacksFor(target)) {
          current = access.get(fallback);
          if (current !== undefined) break;
        }
        // Nothing restricts this directive, so adding sources would only narrow it.
        if (current === undefined) continue;
      }
      if (current.includes("*")) continue;

      const next = current.filter((source) => source !== "'none'");
      for (const source of needed) {
        if (!next.includes(source)) next.push(source);
      }
      access.set(target, next);
    }
  }
}

function mergePolicy(policy: string, sources: Readonly<Record<string, readonly string[]>>): string {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (!name) continue;
    const key = name.toLowerCase();
    // Browsers ignore a repeated directive, so the first one wins.
    if (!directives.has(key)) directives.set(key, values);
  }

  addSources(
    {
      get: (name) => {
        const value = directives.get(name);
        return value ? [...value] : undefined;
      },
      set: (name, value) => directives.set(name, value),
    },
    sources,
  );

  return [...directives].map(([name, values]) => [name, ...values].join(" ")).join("; ");
}

function mergeDirectives(
  directives: Readonly<Record<string, CspDirectiveValue>>,
  sources: Readonly<Record<string, readonly string[]>>,
): Record<string, CspDirectiveValue> {
  const next: Record<string, CspDirectiveValue> = { ...directives };
  const normalize = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const keyFor = (name: string) => Object.keys(next).find((key) => normalize(key) === name);

  addSources(
    {
      get: (name) => {
        const key = keyFor(name);
        const value = key === undefined ? undefined : next[key];
        if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
        if (Array.isArray(value)) return [...value];
        return undefined;
      },
      set: (name, value) => {
        next[keyFor(name) ?? name] = value;
      },
    },
    sources,
  );

  return next;
}
