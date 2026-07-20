import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FarmPlugin,
  FarmPluginClientConfig,
  FarmPluginClientReference,
  FarmPluginClientSource,
} from "./plugin";

export interface ResolvedFarmClientPlugin {
  name: string;
  version?: string;
  enforce?: "pre" | "post";
  source: string;
  publicOptions?: unknown;
}

export interface FarmClientPluginEntryCode {
  imports: string;
  registrations: string;
  plugins: ResolvedFarmClientPlugin[];
}

export function resolveFarmClientPlugins(
  plugins: readonly FarmPlugin[] | undefined,
  root: string,
): ResolvedFarmClientPlugin[] {
  if (!plugins?.length) return [];

  return plugins.flatMap((plugin) => {
    if (!plugin.client) return [];
    const reference = normalizeClientReference(plugin.client);
    assertPublicOptions(reference.publicOptions, plugin.name);

    return [
      {
        name: plugin.name,
        version: plugin.version,
        enforce: plugin.enforce,
        source: resolveClientSource(reference.source, root, plugin.name),
        publicOptions: reference.publicOptions,
      },
    ];
  });
}

export function generateFarmClientPluginEntryCode(
  plugins: readonly FarmPlugin[] | undefined,
  root: string,
): FarmClientPluginEntryCode {
  const resolved = resolveFarmClientPlugins(plugins, root);
  const imports = resolved
    .map(
      (plugin, index) =>
        `import farmClientPlugin${index} from ${JSON.stringify(plugin.source)};`,
    )
    .join("\n");
  const registrations = `[
${resolved
  .map(
    (plugin, index) => `  {
    name: ${JSON.stringify(plugin.name)},
    version: ${serializeOptionalString(plugin.version)},
    enforce: ${serializeOptionalString(plugin.enforce)},
    definition: farmClientPlugin${index},
    options: ${serializePublicOptions(plugin.publicOptions)},
  }`,
  )
  .join(",\n")}
]`;

  return { imports, registrations, plugins: resolved };
}

function normalizeClientReference(reference: FarmPluginClientReference): {
  source: FarmPluginClientSource;
  publicOptions?: unknown;
} {
  if (typeof reference === "string" || isUrlLike(reference)) {
    return { source: reference };
  }

  const config = reference as FarmPluginClientConfig;
  if (!config.source) {
    throw new TypeError("Farm client plugin config requires a source");
  }
  return {
    source: config.source,
    publicOptions: config.public,
  };
}

function resolveClientSource(
  source: FarmPluginClientSource,
  root: string,
  name: string,
): string {
  if (isUrlLike(source)) {
    if (source.protocol !== "file:") {
      throw new TypeError(
        `Client plugin "${name}" must use a file URL, project path, or package specifier`,
      );
    }
    return normalizePath(fileURLToPath(source));
  }

  const value = source.trim();
  if (!value) {
    throw new TypeError(`Client plugin "${name}" has an empty source`);
  }
  if (value.startsWith("file:")) {
    return normalizePath(fileURLToPath(new URL(value)));
  }
  if (value.startsWith(".")) {
    return normalizePath(path.resolve(root, value));
  }
  if (path.isAbsolute(value)) {
    return normalizePath(value);
  }
  return value;
}

function assertPublicOptions(value: unknown, pluginName: string): void {
  if (value === undefined) return;
  const seen = new WeakSet<object>();

  const visit = (current: unknown, pathSegments: string[]): void => {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return;
    }
    if (typeof current === "number") {
      if (Number.isFinite(current)) return;
      throwPublicOptionError(
        pluginName,
        pathSegments,
        "must be a finite number",
      );
    }
    if (typeof current !== "object") {
      throwPublicOptionError(
        pluginName,
        pathSegments,
        `cannot contain ${typeof current} values`,
      );
    }
    if (seen.has(current)) {
      throwPublicOptionError(
        pluginName,
        pathSegments,
        "cannot contain circular references",
      );
    }
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) =>
        visit(item, [...pathSegments, String(index)]),
      );
      seen.delete(current);
      return;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throwPublicOptionError(
        pluginName,
        pathSegments,
        "must contain only plain objects and arrays",
      );
    }
    for (const [key, item] of Object.entries(current)) {
      visit(item, [...pathSegments, key]);
    }
    seen.delete(current);
  };

  visit(value, []);
}

function throwPublicOptionError(
  pluginName: string,
  pathSegments: string[],
  message: string,
): never {
  const location = pathSegments.length
    ? ` at public.${pathSegments.join(".")}`
    : "";
  throw new TypeError(`Client plugin "${pluginName}"${location} ${message}`);
}

function serializePublicOptions(value: unknown): string {
  if (value === undefined) return "undefined";
  return `JSON.parse(${JSON.stringify(JSON.stringify(value))})`;
}

function serializeOptionalString(value: string | undefined): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isUrlLike(value: unknown): value is URL {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as URL).href === "string" &&
    typeof (value as URL).protocol === "string",
  );
}
