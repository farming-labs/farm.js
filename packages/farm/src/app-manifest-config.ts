/**
 * `agent.manifest`: which sections `/.well-known/farmjs.json` shows. Every section is shown by
 * default; a section set to `false` is served as `null` (hidden by the app), unlike an empty
 * list, which means there is nothing to show.
 */

/** Per-section options for `/.well-known/farmjs.json`. Every section is shown by default. */
export interface FarmAppManifestConfig {
  /**
   * The `app` section. `false` serves `app: null`; an object leaves out the Farm version
   * (`version`), the `renderer` or the `build` ID. `basePath` is always kept.
   *
   * @default true
   */
  app?: boolean | { version?: boolean; renderer?: boolean; build?: boolean };
  /**
   * Installed `@farm.js/*` and `@farming-labs/*` packages. `"names"` lists them with `null`
   * versions; `false` serves `packages: null`.
   *
   * @default true
   */
  packages?: boolean | "names";
  /**
   * MCP servers and their tools. `schemas: false` drops tools' `inputSchema` and
   * `outputSchema`; `hide` leaves out a server (`"store"`) or one of its tools
   * (`"store/list_orders"`). `false` serves `mcp: null`.
   *
   * @default true
   */
  mcp?: boolean | { schemas?: boolean; hide?: string[] };
  /**
   * WebMCP browser tools. `hide` leaves out tools by name; `false` serves `webmcp: null`.
   *
   * @default true
   */
  webmcp?: boolean | { hide?: string[] };
  /** Integration keys, categories and providers. `false` serves `integrations: null`. */
  integrations?: boolean;
  /** The app's agent surfaces (API catalog, llms.txt, OpenAPI). `false` serves `agent: null`. */
  agent?: boolean;
  /** Plugin names. `false` serves `plugins: null`. */
  plugins?: boolean;
}

export interface ResolvedFarmAppManifestConfig {
  app: false | { version: boolean; renderer: boolean; build: boolean };
  packages: boolean | "names";
  mcp: false | { schemas: boolean; hide: string[] };
  webmcp: false | { hide: string[] };
  integrations: boolean;
  agent: boolean;
  plugins: boolean;
}

const NAME = "agent.manifest";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(value: Record<string, unknown>, keys: readonly string[], name: string) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      throw new TypeError(`${name} has an unknown option "${key}"; expected ${keys.join(", ")}.`);
    }
  }
}

function readBoolean(value: unknown, name: string, fallback = true): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean.`);
  return value;
}

function readHide(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new TypeError(`${name} must be an array of non-empty strings.`);
  }
  return [...new Set(value.map((entry: string) => entry.trim()))];
}

/** Section switches with only `true`/`false` or an options object. */
function readSection<T>(
  value: unknown,
  name: string,
  keys: readonly string[],
  read: (options: Record<string, unknown>) => T,
): false | T {
  if (value === false) return false;
  if (value === undefined || value === true) return read({});
  if (!isObject(value)) throw new TypeError(`${name} must be true, false, or an options object.`);
  checkKeys(value, keys, name);
  return read(value);
}

/**
 * Validates `agent.manifest`. `false` turns the manifest off; `true`, `undefined` and `{}`
 * show every section. Accepts its own output, so resolved config passes through unchanged.
 */
export function resolveFarmAppManifestConfig(
  input: unknown,
): false | ResolvedFarmAppManifestConfig {
  if (input === false) return false;
  if (input !== undefined && input !== true && !isObject(input)) {
    throw new TypeError(`${NAME} must be true, false, or an options object.`);
  }
  const config = isObject(input) ? input : {};
  checkKeys(config, ["app", "packages", "mcp", "webmcp", "integrations", "agent", "plugins"], NAME);
  const packages = config.packages;
  if (packages !== undefined && typeof packages !== "boolean" && packages !== "names") {
    throw new TypeError(`${NAME}.packages must be true, false, or "names".`);
  }
  return {
    app: readSection(config.app, `${NAME}.app`, ["version", "renderer", "build"], (app) => ({
      version: readBoolean(app.version, `${NAME}.app.version`),
      renderer: readBoolean(app.renderer, `${NAME}.app.renderer`),
      build: readBoolean(app.build, `${NAME}.app.build`),
    })),
    packages: packages ?? true,
    mcp: readSection(config.mcp, `${NAME}.mcp`, ["schemas", "hide"], (mcp) => ({
      schemas: readBoolean(mcp.schemas, `${NAME}.mcp.schemas`),
      hide: readHide(mcp.hide, `${NAME}.mcp.hide`),
    })),
    webmcp: readSection(config.webmcp, `${NAME}.webmcp`, ["hide"], (webmcp) => ({
      hide: readHide(webmcp.hide, `${NAME}.webmcp.hide`),
    })),
    integrations: readBoolean(config.integrations, `${NAME}.integrations`),
    agent: readBoolean(config.agent, `${NAME}.agent`),
    plugins: readBoolean(config.plugins, `${NAME}.plugins`),
  };
}
