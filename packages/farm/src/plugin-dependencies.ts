/**
 * Plugins that need other plugins. A dependency is named by the other
 * plugin's full name (`farm:teams`), the part after its last `:` or `/`
 * (`teams`, also its `farm <name> migrate` command), or an integration key.
 */

/** `farm:teams` and `@acme/teams` → `teams`. */
export function pluginShortName(name: string): string {
  return name.slice(Math.max(name.lastIndexOf(":"), name.lastIndexOf("/")) + 1);
}

type DependentPlugin = { name: string; dependsOn?: readonly string[] };

/**
 * Fail while the config loads when a plugin needs one that is not configured,
 * names itself, or the declared dependencies form a cycle.
 */
export function assertPluginDependencies(
  plugins: readonly DependentPlugin[],
  integrations?: Record<string, unknown> | readonly unknown[],
): void {
  const integrationKeys =
    integrations && !Array.isArray(integrations) ? Object.keys(integrations) : [];
  const matches = (plugin: DependentPlugin, dependency: string) =>
    plugin.name === dependency || pluginShortName(plugin.name) === dependency;

  for (const plugin of plugins) {
    if (plugin.dependsOn === undefined) continue;
    if (
      !Array.isArray(plugin.dependsOn) ||
      plugin.dependsOn.some((entry) => typeof entry !== "string" || entry.trim() === "")
    ) {
      throw new TypeError(
        `Plugin "${plugin.name}" has an invalid \`dependsOn\`: list plugin names, such as ["teams"].`,
      );
    }
    for (const dependency of plugin.dependsOn) {
      if (matches(plugin, dependency)) {
        throw new Error(`Plugin "${plugin.name}" lists itself in \`dependsOn\`.`);
      }
      const found =
        plugins.some((candidate) => candidate !== plugin && matches(candidate, dependency)) ||
        integrationKeys.includes(dependency);
      if (!found) {
        const configured = [
          ...plugins.map((candidate) => candidate.name),
          ...integrationKeys,
        ].filter((name) => name !== plugin.name);
        throw new Error(
          `Plugin "${plugin.name}" depends on "${dependency}", which is not configured. Add it to \`plugins\` (or \`integrations\`) in farm.config.${configured.length > 0 ? ` Configured: ${configured.join(", ")}.` : ""}`,
        );
      }
    }
  }

  // A cycle in what plugins declare is a mistake: neither can come first.
  const state = new Map<DependentPlugin, "visiting" | "done">();
  const path: DependentPlugin[] = [];
  const visit = (plugin: DependentPlugin) => {
    if (state.get(plugin) === "done") return;
    if (state.get(plugin) === "visiting") {
      const cycle = [...path.slice(path.indexOf(plugin)), plugin].map((entry) =>
        pluginShortName(entry.name),
      );
      throw new Error(`Plugins depend on each other in a cycle: ${cycle.join(" → ")}.`);
    }
    state.set(plugin, "visiting");
    path.push(plugin);
    for (const dependency of plugin.dependsOn ?? []) {
      for (const candidate of plugins) {
        if (candidate !== plugin && matches(candidate, dependency)) visit(candidate);
      }
    }
    path.pop();
    state.set(plugin, "done");
  };
  for (const plugin of plugins) visit(plugin);
}
