import { cloneScriptDefinition, readScriptHandle } from "./shared.js";
import type { ResolvedScriptDefinition, ResolvedScriptsOptions, ScriptsOptions } from "./types.js";

export function resolveScriptsOptions(options: ScriptsOptions): ResolvedScriptsOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("scripts options must be an object");
  }
  if ("enabled" in options) {
    throw new TypeError(
      "scripts does not accept enabled; remove scripts() from plugins to disable it",
    );
  }
  if (!Array.isArray(options.scripts) || options.scripts.length === 0) {
    throw new TypeError("scripts requires at least one defineScript() handle");
  }

  const definitions: ResolvedScriptDefinition[] = [];
  const names = new Map<string, ResolvedScriptDefinition>();
  const sources = new Map<string, string>();

  for (const handle of options.scripts) {
    const marked = readScriptHandle(handle);
    if (!marked) {
      throw new TypeError(
        "scripts entries must come from defineScript() in @farm.js/scripts/client",
      );
    }
    const definition = cloneScriptDefinition(marked);
    if (names.has(definition.name)) {
      throw new TypeError(`scripts contains duplicate name ${JSON.stringify(definition.name)}`);
    }
    const sourceOwner = sources.get(definition.src);
    if (sourceOwner) {
      throw new TypeError(
        `scripts ${JSON.stringify(sourceOwner)} and ${JSON.stringify(definition.name)} use the same src; use one typed handle for that vendor script`,
      );
    }
    names.set(definition.name, definition);
    sources.set(definition.src, definition.name);
    definitions.push(definition);
  }

  for (const definition of definitions) {
    for (const dependency of definition.dependsOn) {
      if (dependency === definition.name) {
        throw new TypeError(`script ${JSON.stringify(definition.name)} cannot depend on itself`);
      }
      if (!names.has(dependency)) {
        throw new TypeError(
          `script ${JSON.stringify(definition.name)} depends on unregistered script ${JSON.stringify(dependency)}`,
        );
      }
    }
  }
  assertAcyclicDependencies(names);

  return Object.freeze({
    scripts: Object.freeze(definitions),
    basePath: "/",
  }) as ResolvedScriptsOptions;
}

function assertAcyclicDependencies(definitions: Map<string, ResolvedScriptDefinition>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(name: string, path: string[]): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      const start = path.indexOf(name);
      const cycle = [...path.slice(start), name];
      throw new TypeError(`scripts dependency cycle: ${cycle.join(" -> ")}`);
    }
    visiting.add(name);
    const definition = definitions.get(name)!;
    for (const dependency of definition.dependsOn) visit(dependency, [...path, name]);
    visiting.delete(name);
    visited.add(name);
  }

  for (const name of definitions.keys()) visit(name, []);
}
