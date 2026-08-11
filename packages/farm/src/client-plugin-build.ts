import fs from "node:fs";
import path from "node:path";
import type { FarmClientPlugin } from "./client/plugin";
import type { FarmPlugin, FarmPluginClientConfig } from "./plugin";

export interface ResolvedFarmClientPlugin {
  name: string;
  version?: string;
  enforce?: "pre" | "post";
  definition: FarmClientPlugin;
  publicData?: unknown;
}

export interface FarmClientPluginEntryCode {
  imports: string;
  registrations: string;
  plugins: ResolvedFarmClientPlugin[];
}

const CLIENT_KEYS = [
  "public",
  "setup",
  "hydration",
  "navigation",
  "error",
  "performance",
  "close",
] as const;
const HYDRATION_KEYS = ["before", "after"] as const;
const NAVIGATION_KEYS = ["before", "loaded", "resolved", "rendered", "error"] as const;
const APP_CLIENT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mts", "mjs"] as const;

/** Resolve the optional application-owned browser lifecycle entry. */
export function resolveFarmAppClientEntry(
  root = process.cwd(),
  srcDir = "src",
): string | undefined {
  const sourceRoot = path.resolve(root, srcDir);
  for (const extension of APP_CLIENT_EXTENSIONS) {
    const candidate = path.join(sourceRoot, `client.${extension}`);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

export function resolveFarmClientPlugins(
  plugins: readonly FarmPlugin[] | undefined,
  _root?: string,
): ResolvedFarmClientPlugin[] {
  if (!plugins?.length) return [];

  return plugins.flatMap((plugin) => {
    if (!plugin.client) return [];
    assertClientLifecycle(plugin.client, plugin.name);
    assertPublicData(plugin.client.public, plugin.name);

    return [
      {
        name: plugin.name,
        version: plugin.version,
        enforce: plugin.enforce,
        definition: plugin.client,
        publicData: plugin.client.public,
      },
    ];
  });
}

export function generateFarmClientPluginEntryCode(
  plugins: readonly FarmPlugin[] | undefined,
  root?: string,
  srcDir = "src",
  appPublicData?: unknown,
): FarmClientPluginEntryCode {
  const resolved = resolveFarmClientPlugins(plugins, root);
  const appClientEntry = root ? resolveFarmAppClientEntry(root, srcDir) : undefined;
  const imports = appClientEntry
    ? `import farmAppClientDefinition from ${JSON.stringify(appClientEntry.replace(/\\/g, "/"))};`
    : "";
  const serializedPlugins = resolved.map(
    (plugin) => `  {
    name: ${JSON.stringify(plugin.name)},
    version: ${serializeOptionalString(plugin.version)},
    enforce: ${serializeOptionalString(plugin.enforce)},
    definition: ${serializeClientLifecycle(plugin.definition, plugin.name)},
    public: ${serializePublicData(plugin.publicData)},
  }`,
  );
  if (appClientEntry) {
    assertPublicData(appPublicData, "farm:app-client");
    serializedPlugins.push(`  {
    name: "farm:app-client",
    enforce: "post",
    definition: farmAppClientDefinition,
    public: ${serializePublicData(appPublicData)},
  }`);
  }
  const registrations = `[
${serializedPlugins.join(",\n")}
]`;

  return { imports, registrations, plugins: resolved };
}

function assertClientLifecycle(client: FarmPluginClientConfig, pluginName: string): void {
  assertLifecycleObject(client, pluginName, "client", CLIENT_KEYS);
  assertHook(client.setup, pluginName, "client.setup");
  assertHook(client.error, pluginName, "client.error");
  assertHook(client.performance, pluginName, "client.performance");
  assertHook(client.close, pluginName, "client.close");

  if (client.hydration !== undefined) {
    assertLifecycleObject(client.hydration, pluginName, "client.hydration", HYDRATION_KEYS);
    assertHook(client.hydration.before, pluginName, "client.hydration.before");
    assertHook(client.hydration.after, pluginName, "client.hydration.after");
  }

  if (client.navigation !== undefined) {
    assertLifecycleObject(client.navigation, pluginName, "client.navigation", NAVIGATION_KEYS);
    for (const key of NAVIGATION_KEYS) {
      assertHook(client.navigation[key], pluginName, `client.navigation.${key}`);
    }
  }
}

function assertLifecycleObject(
  value: unknown,
  pluginName: string,
  location: string,
  allowedKeys: readonly string[],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Client plugin "${pluginName}" ${location} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Client plugin "${pluginName}" ${location} must be a plain object`);
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throw new TypeError(`Client plugin "${pluginName}" ${location} cannot contain symbol keys`);
    }
    if (!allowedKeys.includes(key)) {
      throw new TypeError(`Client plugin "${pluginName}" has an unknown ${location}.${key} option`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) {
      throw new TypeError(`Client plugin "${pluginName}" ${location}.${key} must be enumerable`);
    }
    if (!("value" in descriptor)) {
      throw new TypeError(`Client plugin "${pluginName}" ${location}.${key} cannot be an accessor`);
    }
  }
}

function assertHook(value: unknown, pluginName: string, location: string): void {
  if (value === undefined) return;
  if (typeof value !== "function") {
    throw new TypeError(`Client plugin "${pluginName}" ${location} must be a function`);
  }
  functionSource(value, pluginName, location);
}

function serializeClientLifecycle(definition: FarmClientPlugin, pluginName: string): string {
  const fields: string[] = [];
  pushHook(fields, "setup", definition.setup, pluginName, "client.setup", 2);
  pushHookGroup(fields, "hydration", definition.hydration, HYDRATION_KEYS, pluginName, 2);
  pushHookGroup(fields, "navigation", definition.navigation, NAVIGATION_KEYS, pluginName, 2);
  pushHook(fields, "error", definition.error, pluginName, "client.error", 2);
  pushHook(fields, "performance", definition.performance, pluginName, "client.performance", 2);
  pushHook(fields, "close", definition.close, pluginName, "client.close", 2);

  return fields.length ? `{\n${fields.join(",\n")}\n  }` : "{}";
}

function pushHookGroup(
  fields: string[],
  groupName: "hydration" | "navigation",
  group: Record<string, unknown> | undefined,
  keys: readonly string[],
  pluginName: string,
  indent: number,
): void {
  if (!group) return;
  const hooks: string[] = [];
  for (const key of keys) {
    pushHook(hooks, key, group[key], pluginName, `client.${groupName}.${key}`, indent + 2);
  }
  fields.push(
    `${" ".repeat(indent)}${JSON.stringify(groupName)}: {\n${hooks.join(",\n")}\n${" ".repeat(indent)}}`,
  );
}

function pushHook(
  fields: string[],
  key: string,
  hook: unknown,
  pluginName: string,
  location: string,
  indent: number,
): void {
  if (hook === undefined) return;
  fields.push(
    `${" ".repeat(indent)}${JSON.stringify(key)}: ${functionSource(hook, pluginName, location)}`,
  );
}

function functionSource(value: unknown, pluginName: string, location: string): string {
  if (typeof value !== "function") {
    throw new TypeError(`Client plugin "${pluginName}" ${location} must be a function`);
  }

  const source = Function.prototype.toString.call(value).trim();
  if (!source || source.includes("[native code]")) {
    throw new TypeError(
      `Client plugin "${pluginName}" ${location} must be authored inline and cannot be native or bound`,
    );
  }

  if (/^(?:async\s+)?function(?:\s*\*)?(?:\s+|\()/.test(source)) {
    return `(${source})`;
  }

  const method = source.match(/^(async\s+)?(\*\s*)?[$A-Z_a-z][$\w]*\s*(\([\s\S]*)$/);
  if (method) {
    const asyncPrefix = method[1] ?? "";
    const generator = method[2] ? "*" : "";
    return `(${asyncPrefix}function${generator}${method[3]})`;
  }

  if (source.includes("=>")) return `(${source})`;

  throw new TypeError(
    `Client plugin "${pluginName}" ${location} must use a function, method, or arrow function`,
  );
}

function assertPublicData(value: unknown, pluginName: string): void {
  if (value === undefined) return;
  const seen = new WeakSet<object>();

  const visit = (current: unknown, pathSegments: string[]): void => {
    if (current === null || typeof current === "string" || typeof current === "boolean") {
      return;
    }
    if (typeof current === "number") {
      if (Number.isFinite(current)) return;
      throwPublicDataError(pluginName, pathSegments, "must be a finite number");
    }
    if (typeof current !== "object") {
      throwPublicDataError(pluginName, pathSegments, `cannot contain ${typeof current} values`);
    }
    if (seen.has(current)) {
      throwPublicDataError(pluginName, pathSegments, "cannot contain circular references");
    }
    seen.add(current);

    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(current, index)) {
          throwPublicDataError(
            pluginName,
            [...pathSegments, String(index)],
            "cannot contain sparse array slots",
          );
        }
        visit(current[index], [...pathSegments, String(index)]);
      }
      for (const key of Reflect.ownKeys(current)) {
        if (key === "length" || (typeof key === "string" && isArrayIndex(key))) continue;
        throwPublicDataError(
          pluginName,
          pathSegments,
          typeof key === "symbol"
            ? "cannot contain symbol keys"
            : `cannot contain non-index array property ${key}`,
        );
      }
      seen.delete(current);
      return;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throwPublicDataError(pluginName, pathSegments, "must contain only plain objects and arrays");
    }
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key === "symbol") {
        throwPublicDataError(pluginName, pathSegments, "cannot contain symbol keys");
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor?.enumerable) {
        throwPublicDataError(
          pluginName,
          [...pathSegments, key],
          "cannot contain non-enumerable properties",
        );
      }
      if (!("value" in descriptor)) {
        throwPublicDataError(
          pluginName,
          [...pathSegments, key],
          "cannot contain accessor properties",
        );
      }
      visit(descriptor.value, [...pathSegments, key]);
    }
    seen.delete(current);
  };

  visit(value, []);
}

function throwPublicDataError(pluginName: string, pathSegments: string[], message: string): never {
  const location = pathSegments.length ? ` at client.public.${pathSegments.join(".")}` : "";
  throw new TypeError(`Client plugin "${pluginName}"${location} ${message}`);
}

function serializePublicData(value: unknown): string {
  if (value === undefined) return "undefined";
  return `JSON.parse(${JSON.stringify(JSON.stringify(value))})`;
}

function serializeOptionalString(value: string | undefined): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function isArrayIndex(key: string): boolean {
  const value = Number(key);
  return Number.isInteger(value) && value >= 0 && value < 4_294_967_295 && String(value) === key;
}
