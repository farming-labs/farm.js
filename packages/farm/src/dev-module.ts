import type { EnvironmentModuleNode, RunnableDevEnvironment } from "vite";

/** @internal The environment registry is owned and closed by Vite. */
export interface FarmDevModuleServer {
  // Environment classes contain private fields. Keep this boundary structural
  // so a plugin's Vite peer can differ from core's installed Vite instance.
  environments: Record<string, unknown>;
}

const failedModules = new WeakMap<object, Map<string, Promise<unknown>>>();

/** @internal Distinguishes an unsupported runtime from a module evaluation error. */
export class FarmDevEnvironmentError extends Error {}

/** @internal Load in the selected environment without sharing SSR/RSC module state. */
export async function loadFarmDevModule<T = Record<string, any>>(
  server: FarmDevModuleServer,
  id: string,
  environmentName: "ssr" | "rsc" = "ssr",
): Promise<T> {
  const environment = server.environments[environmentName] as RunnableDevEnvironment | undefined;
  // Use the runner capability rather than instanceof: plugins can provide an
  // environment from a separate Vite installation. Do not create a second runner
  // or silently execute a remote runtime's modules inside Node.
  const runner = environment?.runner;
  if (!environment || !runner || typeof runner.import !== "function") {
    throw new FarmDevEnvironmentError(
      `[Farm.js] Cannot load ${JSON.stringify(id)}: the "${environmentName}" development environment must provide a module runner. Remote runtimes require a request/response adapter.`,
    );
  }
  try {
    return await runner.import<T>(id);
  } catch (error) {
    // The runner no longer writes the legacy graph's ssrError field. Remember
    // settled failures so creating a missing dependency can retry its importers.
    // Do not wait for unrelated imports that are still evaluating.
    const failures = failedModules.get(environment) ?? new Map<string, Promise<unknown>>();
    failedModules.set(environment, failures);
    await Promise.all(
      [...(runner.evaluatedModules?.idToModuleMap.values() ?? [])]
        .filter((module) => module.evaluated && module.promise)
        .map(async (module) => {
          try {
            await module.promise;
          } catch {
            failures.set(module.id, module.promise!);
          }
        }),
    );
    throw error;
  }
}

/**
 * @internal Invalidates `file` and the SSR modules that import it when that chain reaches one
 * of `targets` (modules whose exports something still holds, such as API route handlers), so
 * importing a target next runs the new code. Returns the targets reached; with none, it leaves
 * the graph to Vite.
 */
export function invalidateFarmDevDependents(
  server: FarmDevModuleServer,
  file: string,
  targets: ReadonlySet<string>,
  environmentName: "ssr" | "rsc" = "ssr",
): string[] {
  const environment = server.environments[environmentName] as RunnableDevEnvironment | undefined;
  const graph = environment?.moduleGraph;
  if (!graph || targets.size === 0) return [];
  const posix = (filePath: string) => filePath.replace(/\\/g, "/");
  const byFile = new Map([...targets].map((target) => [posix(target), target]));
  const reached = new Set<string>();
  const seen = new Set<EnvironmentModuleNode>();
  const queue = [...(graph.getModulesByFile(posix(file)) ?? [])];
  while (queue.length > 0) {
    const node = queue.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const target = node.file ? byFile.get(posix(node.file)) : undefined;
    if (target) reached.add(target);
    queue.push(...node.importers);
  }
  if (reached.size === 0) return [];
  const evaluatedModules = environment.runner?.evaluatedModules;
  for (const node of seen) {
    graph.invalidateModule(node);
    const evaluated = node.id ? evaluatedModules?.getModuleById(node.id) : undefined;
    if (evaluated) evaluatedModules!.invalidateModule(evaluated);
  }
  return [...reached];
}

/** @internal Retry failed imports after a file appears, preserving healthy modules. */
export function invalidateFailedFarmDevModules(server: FarmDevModuleServer): void {
  for (const entry of Object.values(server.environments)) {
    const environment = entry as RunnableDevEnvironment;
    const failures = failedModules.get(environment);
    if (!failures?.size) continue;
    const runner = environment.runner;
    for (const [id, failed] of failures) {
      const evaluated = runner.evaluatedModules.getModuleById(id);
      // HMR may already have recovered it; do not invalidate fresh module state.
      if (evaluated?.promise !== failed) continue;
      const transformed = environment.moduleGraph.getModuleById(id);
      if (transformed) environment.moduleGraph.invalidateModule(transformed);
      if (evaluated) runner.evaluatedModules.invalidateModule(evaluated);
    }
    failures.clear();
  }
}
