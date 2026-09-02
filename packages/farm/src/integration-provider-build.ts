import path from "node:path";
import type { FarmIntegrationProvider } from "./integrations";
import { isFarmIntegrationProviderComponentReference } from "./integrations";
import { toViteModuleId } from "./utils";

export type FarmIntegrationProviderClientCode = {
  hasProviders: boolean;
  imports: string;
  runtime: string;
};

export function generateFarmIntegrationProviderClientCode(
  providers: FarmIntegrationProvider[],
  root: string,
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

  return {
    hasProviders: renderedProviders.length > 0,
    imports: imports.join("\n"),
    runtime: `const integrationProviders = [${registrations.join(",\n")}];

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
): { imports: string; entries: string; hasClerkProvider: boolean } {
  const imports: string[] = [];
  const entries: string[] = [];

  providers.forEach((provider, index) => {
    if (!isFarmIntegrationProviderComponentReference(provider.component)) return;
    const namespace = `FarmServerIntegrationProviderModule${index}`;
    imports.push(
      `import * as ${namespace} from ${JSON.stringify(resolveProviderModule(provider.component.module, root))};`,
    );
    entries.push(
      `[${JSON.stringify(createFarmIntegrationProviderModuleKey(provider.component))}, ${namespace}[${JSON.stringify(provider.component.export || "default")}]]`,
    );
  });

  return {
    imports: imports.join("\n"),
    entries: entries.join(",\n"),
    hasClerkProvider: providers.some((provider) => provider.type === "clerk"),
  };
}

function resolveProviderModule(moduleId: string, root: string): string {
  if (!moduleId.startsWith(".")) return moduleId;
  return toViteModuleId(path.resolve(root, moduleId), root);
}
