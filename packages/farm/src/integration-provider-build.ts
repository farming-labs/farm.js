import path from "node:path";
import type { FarmIntegrationProvider } from "./integrations";
import { isFarmIntegrationProviderComponentReference } from "./integrations";
import { toViteModuleId } from "./utils";

export type FarmIntegrationProviderClientCode = {
  hasProviders: boolean;
  imports: string;
  runtime: string;
};

/**
 * Whether a provider component comes from a module the renderer compiles
 * itself, rather than a plain function component.
 *
 * Only the renderer's own declared extensions count here. The resolved set
 * from getFarmRendererComponentExtensions() always folds in .ts/.tsx/.js/.jsx,
 * and that is exactly the distinction this needs to keep: under the Svelte
 * renderer a .svelte provider is a Svelte component while a .tsx provider is a
 * function component.
 */
function isRendererCompiledComponent(
  moduleId: string,
  rendererComponentExtensions: readonly string[],
): boolean {
  const lowered = moduleId.toLowerCase();
  return rendererComponentExtensions.some((extension) => lowered.endsWith(extension.toLowerCase()));
}

/**
 * Renderers that compile their own components cannot tell a function
 * component from one of their own at runtime, so Farm marks the ones it wires
 * up. Renderers without the hook (React) get the identity function.
 */
const FARM_PROVIDER_MARK_HELPER = [
  "const farmMarkProviderComponent =",
  '  typeof React.markFunctionComponent === "function"',
  "    ? React.markFunctionComponent",
  "    : function (component) { return component; };",
].join("\n");

export function generateFarmIntegrationProviderClientCode(
  providers: FarmIntegrationProvider[],
  root: string,
  rendererComponentExtensions: readonly string[] = [],
): FarmIntegrationProviderClientCode {
  const renderedProviders = providers.filter(
    (provider) => provider.component || provider.type === "clerk",
  );
  const imports: string[] = [];
  const registrations: string[] = [];
  let hasClerkProvider = false;

  renderedProviders.forEach((provider, index) => {
    let componentExpression = "null";
    if (isFarmIntegrationProviderComponentReference(provider.component)) {
      const namespace = `FarmIntegrationProviderModule${index}`;
      imports.push(
        `import * as ${namespace} from ${JSON.stringify(resolveProviderModule(provider.component.module, root))};`,
      );
      componentExpression = `${namespace}[${JSON.stringify(provider.component.export || "default")}]`;
      if (
        rendererComponentExtensions.length > 0 &&
        !isRendererCompiledComponent(provider.component.module, rendererComponentExtensions)
      ) {
        componentExpression = `farmMarkProviderComponent(${componentExpression})`;
      }
    } else if (typeof provider.component === "function") {
      throw new Error(
        `Integration provider "${provider.name}" must use an importable component reference for client hydration, for example component: { module: "@/components/provider" }.`,
      );
    } else if (provider.type === "clerk") {
      hasClerkProvider = true;
      componentExpression = "FarmClerkProvider";
    }

    registrations.push(`{
  name: ${JSON.stringify(provider.name)},
  type: ${JSON.stringify(provider.type)},
  props: ${JSON.stringify(provider.props || {})},
  Component: ${componentExpression},
}`);
  });

  if (hasClerkProvider) {
    imports.unshift(`import { ClerkProvider as FarmClerkProvider } from "@clerk/react";`);
  }

  const markHelper = registrations.some((registration) =>
    registration.includes("farmMarkProviderComponent("),
  )
    ? `${FARM_PROVIDER_MARK_HELPER}\n`
    : "";

  return {
    hasProviders: renderedProviders.length > 0,
    imports: imports.join("\n"),
    runtime: `${markHelper}const integrationProviders = [${registrations.join(",\n")}];

function wrapWithIntegrationProviders(element) {
  let wrapped = element;
  for (let index = integrationProviders.length - 1; index >= 0; index--) {
    const provider = integrationProviders[index];
    if (!provider.Component) {
      throw new Error("Integration provider " + provider.name + " did not export its configured component.");
    }
    wrapped = React.createElement(provider.Component, provider.props || {}, wrapped);
  }
  return wrapped;
}`,
  };
}

export function createFarmIntegrationProviderModuleKey(component: {
  module: string;
  export?: string;
}): string {
  return `${component.module}\0${component.export || "default"}`;
}

export function generateFarmIntegrationProviderServerModules(
  providers: FarmIntegrationProvider[],
  root: string,
  rendererComponentExtensions: readonly string[] = [],
): { imports: string; entries: string; helpers: string; hasClerkProvider: boolean } {
  const imports: string[] = [];
  const entries: string[] = [];
  let needsMarkHelper = false;

  providers.forEach((provider, index) => {
    if (!isFarmIntegrationProviderComponentReference(provider.component)) return;
    const namespace = `FarmServerIntegrationProviderModule${index}`;
    imports.push(
      `import * as ${namespace} from ${JSON.stringify(resolveProviderModule(provider.component.module, root))};`,
    );
    let componentExpression = `${namespace}[${JSON.stringify(provider.component.export || "default")}]`;
    if (
      rendererComponentExtensions.length > 0 &&
      !isRendererCompiledComponent(provider.component.module, rendererComponentExtensions)
    ) {
      componentExpression = `farmMarkProviderComponent(${componentExpression})`;
      needsMarkHelper = true;
    }
    entries.push(
      `[${JSON.stringify(createFarmIntegrationProviderModuleKey(provider.component))}, ${componentExpression}]`,
    );
  });

  return {
    imports: imports.join("\n"),
    entries: entries.join(",\n"),
    helpers: needsMarkHelper ? FARM_PROVIDER_MARK_HELPER : "",
    hasClerkProvider: providers.some(
      (provider) => provider.type === "clerk" && !provider.component,
    ),
  };
}

function resolveProviderModule(moduleId: string, root: string): string {
  if (!moduleId.startsWith(".")) return moduleId;
  return toViteModuleId(path.resolve(root, moduleId), root);
}
