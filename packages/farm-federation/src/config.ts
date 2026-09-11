import type { ModuleFederationOptions } from "@module-federation/vite";

export interface FederationRemote {
  /** URL of the producer's mf-manifest.json or remoteEntry.js. */
  entry: string;
  /** Producer name. Defaults to the remote alias. */
  name?: string;
  /** Remote entry format. Farm producers use module by default. */
  type?: string;
  /** Module Federation share scope used by this producer. */
  shareScope?: string | string[];
}

export interface FederationSharedPackage {
  singleton?: boolean;
  requiredVersion?: string | false;
  strictVersion?: boolean;
  eager?: boolean;
  shareScope?: string;
  import?: string | false;
}

export type FederationSharedPackages = string[] | Record<string, true | FederationSharedPackage>;

export interface FederationSharedOptions {
  /** Share the active Farm renderer and its browser runtime as singletons. Defaults to true. */
  renderer?: boolean;
  /** Additional application packages to share. */
  packages?: FederationSharedPackages;
}

export interface FederationOptions {
  /** Stable name of this producer or consumer. */
  name: string;
  /** Browser modules this application publishes. */
  exposes?: Record<string, string | { import: string }>;
  /** Independently deployed browser producers this application consumes. */
  remotes?: Record<string, string | FederationRemote>;
  /** Renderer and application dependencies reused across federated applications. */
  shared?: "renderer" | false | FederationSharedOptions;
  /** Generate mf-manifest.json. Defaults to true when modules are exposed. */
  manifest?: boolean;
  /** Remote entry filename. */
  filename?: string;
  /** Public origin or base URL used in generated federation assets. */
  publicPath?: string;
  /** Generate and consume remote TypeScript declarations. Defaults to true. */
  types?: boolean;
  /** Development behavior for independently running producers. */
  dev?: {
    remoteHmr?: boolean | "full-reload";
  };
}

export interface FederationRenderer {
  name: string;
  dedupe?: readonly string[];
}

export interface ResolvedFederationOptions {
  remoteAliases: string[];
  upstream: ModuleFederationOptions;
}

const SERVER_OPTIONS = ["server", "serverRemotes", "ssrExternals", "target", "experiments"];

export function resolveFederationOptions(
  options: FederationOptions,
  renderer: FederationRenderer,
): ResolvedFederationOptions {
  assertPlainObject(options, "Federation options");
  for (const field of SERVER_OPTIONS) {
    if (field in options) {
      throw new TypeError(
        `Federation option ${field} is not available in the client-only release. Follow server federation design in https://github.com/farming-labs/farm.js/issues/885`,
      );
    }
  }

  const name = nonEmptyString(options.name, "Federation name");
  const exposes = normalizeExposes(options.exposes ?? {});
  const remotes = normalizeRemotes(options.remotes ?? {});
  const filename = normalizeOutputFile(options.filename ?? "remoteEntry.js");
  const manifest = booleanOption(options.manifest, "manifest") ?? Object.keys(exposes).length > 0;
  const types = booleanOption(options.types, "types") ?? true;
  const shared = normalizeShared(options.shared, renderer);
  const publicPath = optionalPublicPath(options.publicPath);
  const remoteHmr = options.dev?.remoteHmr;
  if (remoteHmr !== undefined && typeof remoteHmr !== "boolean" && remoteHmr !== "full-reload") {
    throw new TypeError("Federation dev.remoteHmr must be true, false, or full-reload");
  }

  return {
    remoteAliases: Object.keys(remotes),
    upstream: {
      name,
      exposes,
      remotes,
      shared,
      filename,
      manifest,
      dts: types
        ? {
            generateTypes: { compileInChildProcess: false },
          }
        : false,
      target: "web",
      ...(publicPath ? { publicPath } : {}),
      ...(remoteHmr === undefined ? {} : { dev: { remoteHmr } }),
    },
  };
}

function normalizeExposes(
  exposes: Record<string, string | { import: string }>,
): NonNullable<ModuleFederationOptions["exposes"]> {
  assertPlainObject(exposes, "Federation exposes");
  return Object.fromEntries(
    Object.entries(exposes).map(([key, value]) => {
      if (key !== "." && !key.startsWith("./")) {
        throw new TypeError(`Federation expose ${JSON.stringify(key)} must be . or start with ./`);
      }
      if (typeof value === "string")
        return [key, nonEmptyString(value, `Federation expose ${key}`)];
      assertPlainObject(value, `Federation expose ${key}`);
      return [key, { import: nonEmptyString(value.import, `Federation expose ${key} import`) }];
    }),
  );
}

function normalizeRemotes(
  remotes: Record<string, string | FederationRemote>,
): NonNullable<ModuleFederationOptions["remotes"]> {
  assertPlainObject(remotes, "Federation remotes");
  return Object.fromEntries(
    Object.entries(remotes).map(([alias, value]) => {
      normalizeRemoteAlias(alias);
      if (typeof value === "string") {
        return [alias, normalizeRemoteString(value, alias)];
      }
      assertPlainObject(value, `Federation remote ${alias}`);
      const entry = normalizeRemoteEntry(value.entry, alias);
      const name =
        value.name === undefined ? alias : nonEmptyString(value.name, `Remote ${alias} name`);
      return [
        alias,
        {
          name,
          entry,
          type:
            value.type === undefined
              ? "module"
              : nonEmptyString(value.type, `Remote ${alias} type`),
          ...(value.shareScope === undefined
            ? {}
            : { shareScope: normalizeShareScope(value.shareScope, alias) }),
        },
      ];
    }),
  );
}

function normalizeShared(
  shared: FederationOptions["shared"],
  renderer: FederationRenderer,
): NonNullable<ModuleFederationOptions["shared"]> {
  if (shared === false) return {};
  if (shared === undefined || shared === "renderer") return rendererShares(renderer);
  assertPlainObject(shared, "Federation shared");
  const includeRenderer = booleanOption(shared.renderer, "shared.renderer") ?? true;
  return {
    ...(includeRenderer ? rendererShares(renderer) : {}),
    ...packageShares(shared.packages ?? []),
  };
}

function rendererShares(renderer: FederationRenderer): Record<string, FederationSharedPackage> {
  const roots = new Set((renderer.dedupe ?? []).map(packageRoot).filter(Boolean));
  if (roots.size === 0) {
    throw new TypeError(
      `Farm renderer ${JSON.stringify(renderer.name)} does not declare packages to share. Set shared to false or provide shared.packages explicitly.`,
    );
  }
  const entries: Array<[string, FederationSharedPackage]> = [];
  for (const root of roots) {
    entries.push([root, { singleton: true }], [`${root}/`, { singleton: true }]);
  }
  return Object.fromEntries(entries);
}

function packageShares(shared: FederationSharedPackages): Record<string, FederationSharedPackage> {
  if (Array.isArray(shared)) {
    return Object.fromEntries(
      shared.map((name) => [nonEmptyString(name, "Federation shared package"), {}]),
    );
  }
  assertPlainObject(shared, "Federation shared packages");
  return Object.fromEntries(
    Object.entries(shared).map(([name, value]) => {
      const normalizedName = nonEmptyString(name, "Federation shared package name");
      if (value === true) return [normalizedName, {}];
      assertPlainObject(value, `Federation shared package ${name}`);
      return [normalizedName, { ...value }];
    }),
  );
}

function packageRoot(value: string): string {
  if (!value) return "";
  const segments = value.split("/");
  return value.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0]!;
}

function normalizeRemoteAlias(value: string): string {
  const alias = nonEmptyString(value, "Federation remote alias");
  if (/\s|[?#\\]/.test(alias) || alias.startsWith("/") || alias.endsWith("/")) {
    throw new TypeError(`Invalid federation remote alias: ${JSON.stringify(value)}`);
  }
  return alias;
}

function normalizeRemoteEntry(value: string, alias: string): string {
  const entry = nonEmptyString(value, `Federation remote ${alias} entry`);
  if (entry.startsWith("/")) {
    if (entry.startsWith("//") || entry.includes("\\")) {
      throw new TypeError(
        `Federation remote ${alias} entry must be a root-relative URL, not a network-path URL`,
      );
    }
    return entry;
  }
  if (entry.includes("\\")) {
    throw new TypeError(`Federation remote ${alias} entry must use URL separators`);
  }
  let parsed: URL;
  try {
    parsed = new URL(entry);
  } catch {
    throw new TypeError(
      `Federation remote ${alias} entry must be an HTTP URL or root-relative URL`,
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new TypeError(`Federation remote ${alias} entry must use HTTP without URL credentials`);
  }
  return parsed.href;
}

function normalizeRemoteString(value: string, alias: string): string {
  const remote = nonEmptyString(value, `Federation remote ${alias}`);
  if (/^(?:https?:)?\//i.test(remote)) return normalizeRemoteEntry(remote, alias);

  const separator = remote.indexOf("@");
  if (separator <= 0 || separator === remote.length - 1) {
    throw new TypeError(
      `Federation remote ${alias} must be an HTTP URL, root-relative URL, or name@URL`,
    );
  }

  const name = remote.slice(0, separator);
  if (/\s|[/?#\\]/.test(name) || hasControlCharacter(name)) {
    throw new TypeError(`Federation remote ${alias} has an invalid remote name`);
  }
  return `${name}@${normalizeRemoteEntry(remote.slice(separator + 1), alias)}`;
}

function normalizeShareScope(value: string | string[], alias: string): string | string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) throw new TypeError(`Remote ${alias} shareScope cannot be empty`);
    return value.map((scope) => nonEmptyString(scope, `Remote ${alias} shareScope`));
  }
  return nonEmptyString(value, `Remote ${alias} shareScope`);
}

function normalizeOutputFile(value: string): string {
  const filename = nonEmptyString(value, "Federation filename").replace(/^\/+/, "");
  const segments = filename.split("/");
  if (
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    !/\.m?js$/i.test(filename)
  ) {
    throw new TypeError("Federation filename must be a safe relative .js or .mjs path");
  }
  return filename;
}

function optionalPublicPath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const publicPath = nonEmptyString(value, "Federation publicPath");
  if (publicPath === "auto") return publicPath;
  if (publicPath.startsWith("/")) {
    if (publicPath.startsWith("//") || publicPath.includes("\\")) {
      throw new TypeError(
        "Federation publicPath must be a root-relative URL, not a network-path URL",
      );
    }
    return publicPath;
  }
  if (publicPath.includes("\\")) {
    throw new TypeError("Federation publicPath must use URL separators");
  }
  let parsed: URL;
  try {
    parsed = new URL(publicPath);
  } catch {
    throw new TypeError("Federation publicPath must be auto, root-relative, or an HTTP URL");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new TypeError("Federation publicPath must use HTTP without URL credentials");
  }
  return parsed.href;
}

function booleanOption(value: boolean | undefined, label: string): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`Federation ${label} must be a boolean`);
  }
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || hasControlCharacter(value)) {
    throw new TypeError(`${label} must be a non-empty string without control characters`);
  }
  return value.trim();
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}
