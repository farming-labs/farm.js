import type { Plugin } from "vite";

type FilterPattern = RegExp | readonly RegExp[] | { include?: unknown; exclude?: unknown };

function asList(value: unknown): RegExp[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  for (const entry of list) {
    if (!(entry instanceof RegExp)) throw new Error("plugin-hook supports RegExp filters only");
  }
  return list as RegExp[];
}

/** Whether `value` passes a hook filter pattern the way Rolldown applies one. */
function passes(pattern: FilterPattern | undefined, value: string): boolean {
  if (pattern === undefined) return true;
  if (pattern instanceof RegExp || Array.isArray(pattern)) {
    return asList(pattern).some((entry) => entry.test(value));
  }
  const { include, exclude } = pattern as { include?: unknown; exclude?: unknown };
  if (asList(exclude).some((entry) => entry.test(value))) return false;
  const included = asList(include);
  return included.length === 0 || included.some((entry) => entry.test(value));
}

/**
 * A plugin hook as the bundler calls it. A hook with a filter returns null without running its
 * handler when the filter excludes the call, so a test also proves the filter admits its ids.
 */
export function pluginHook<Args extends unknown[], Result>(
  plugin: Plugin,
  hook: "resolveId" | "load" | "transform",
  context: object = {},
): (...args: Args) => Result | null {
  const value = plugin[hook] as
    | ((...args: Args) => Result)
    | { filter?: { id?: FilterPattern; code?: FilterPattern }; handler: (...args: Args) => Result }
    | undefined;
  if (!value) throw new Error(`${plugin.name} has no ${hook} hook`);
  if (typeof value === "function") return (...args) => value.apply(context, args);
  return (...args) => {
    const id = String(hook === "transform" ? args[1] : args[0]).replace(/\\/g, "/");
    if (!passes(value.filter?.id, id)) return null;
    if (hook === "transform" && !passes(value.filter?.code, String(args[0]))) return null;
    return value.handler.apply(context, args);
  };
}
