import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Plugin, ResolvedConfig, Rollup, ViteDevServer } from "vite";
import type { FarmFontDisplay, FarmFontSource, RemoteFontSource } from "./font";

const FONT_IMPORTS = new Set(["@farm.js/core", "@farm.js/core/font"]);
const FONT_FUNCTIONS = new Set<FontLoaderKind>(["localFont", "remoteFont"]);
const FONT_CSS_PREFIX = "\0farm:font-css:";
const FONT_RUNTIME_ID = "\0farm:font-runtime";
const PUBLIC_FONT_RUNTIME_ID = "virtual:farm-font-runtime";
const PRELOAD_HEADER_MARKER = "__FARM_FONT_PRELOAD_HEADER__";
const FONT_SECTION_START = "/* farm-fonts:start */";
const FONT_SECTION_END = "/* farm-fonts:end */";
const MODULE_EXTENSION_RE = /\.[cm]?[jt]sx?$/;
const FONT_EXTENSION_RE = /\.(woff2?|ttf|otf)$/i;
const MAX_REMOTE_FONT_BYTES = 20 * 1024 * 1024;
const FONT_REGISTRIES_KEY = Symbol.for("farm.fontRegistries");
const FONT_REMOTE_BYTES_KEY = Symbol.for("farm.fontRemoteBytes");

type FontLoaderKind = "localFont" | "remoteFont";
type OutputAsset = Rollup.OutputAsset;
type OutputBundle = Rollup.OutputBundle;

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface FontResource {
  bytes?: Buffer;
  extension: string;
  format: string;
  hash: string;
  outputFileName?: string;
  publicPath?: string;
  publicUrl: string;
}

interface NormalizedFontSource {
  source: string;
  weight: string;
  style: string;
  unicodeRange?: string;
  resource: FontResource;
}

interface FontDefinition {
  id: string;
  family: string;
  className: string;
  variableClassName: string;
  variable?: string;
  fallback: string[];
  display: FarmFontDisplay;
  preload: boolean;
  weight?: number | string;
  style?: string;
  sources: NormalizedFontSource[];
}

interface FontCall {
  kind: FontLoaderKind;
  binding?: string;
  node: AstNode;
  ancestors: readonly AstNode[];
}

interface Replacement {
  start: number;
  end: number;
  code: string;
}

export interface TransformFarmFontCallsOptions {
  code: string;
  id: string;
  root: string;
  production: boolean;
  parse: (code: string) => AstNode;
  register: (
    moduleId: string,
    calls: Array<{ kind: FontLoaderKind; options: Record<string, unknown> }>,
  ) => Promise<FontDefinition[]>;
}

export interface TransformFarmFontCallsResult {
  code: string;
  fonts: FontDefinition[];
}

const registries = getGlobalMap<string, FarmFontRegistry>(FONT_REGISTRIES_KEY);
const remoteBytes = getGlobalMap<string, Promise<Buffer>>(FONT_REMOTE_BYTES_KEY);

export function farmFontImportsPlugin(
  options: { root?: string; basePath?: string; publicDir?: string | false } = {},
): Plugin {
  let root = normalizeRoot(options.root || process.cwd());
  let production = process.env.NODE_ENV === "production";
  let registry = getOrCreateRegistry(root, options.basePath, options.publicDir);

  const updateRoot = (nextRoot: string, basePath?: string, publicDir?: string | false) => {
    const normalized = normalizeRoot(nextRoot);
    root = normalized;
    registry = getOrCreateRegistry(root, basePath, publicDir);
  };

  return {
    name: "farm:font-imports",
    enforce: "post",

    configResolved(config: ResolvedConfig) {
      production = config.command === "build";
      updateRoot(
        config.root,
        options.basePath || config.base,
        options.publicDir === undefined ? config.publicDir : options.publicDir,
      );
      registry.production = production;
    },

    configureServer(server: ViteDevServer) {
      updateRoot(
        server.config.root,
        options.basePath || server.config.base,
        options.publicDir === undefined ? server.config.publicDir : options.publicDir,
      );
      registry.production = false;
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url || "/", "http://farm.local").pathname;

        if (pathname === "/@farm/fonts.css") {
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/css; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(registry.renderCss(false));
          return;
        }

        const resource = registry.getDevResource(pathname);
        if (!resource?.bytes) {
          next();
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", fontContentType(resource.extension));
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.end(resource.bytes);
      });
    },

    resolveId(id) {
      if (id === PUBLIC_FONT_RUNTIME_ID || id === FONT_RUNTIME_ID) return FONT_RUNTIME_ID;
      if (id.startsWith("virtual:farm-font-css/")) {
        return `${FONT_CSS_PREFIX}${id.slice("virtual:farm-font-css/".length)}`;
      }
      if (id.startsWith(FONT_CSS_PREFIX)) return id;
      return null;
    },

    load(id) {
      if (id === FONT_RUNTIME_ID) {
        return `export const farmFontPreloadHeader = decodeURIComponent(${JSON.stringify(PRELOAD_HEADER_MARKER)});`;
      }
      if (!id.startsWith(FONT_CSS_PREFIX)) return null;
      return registry.renderFontCss(
        id.slice(FONT_CSS_PREFIX.length).replace(/\.css$/, ""),
        production,
      );
    },

    async transform(code, id) {
      const result = await transformFarmFontCalls({
        code,
        id,
        root,
        production,
        parse: (source) => this.parse(source) as unknown as AstNode,
        register: (moduleId, calls) => registry.register(moduleId, calls, production),
      });

      if (!result) registry.clearModule(id.split("?", 1)[0]);

      return result ? { code: result.code, map: null } : null;
    },

    async generateBundle(_options, bundle) {
      registry.emitAssets(this, bundle);
    },
  };
}

export async function transformFarmFontCalls(
  options: TransformFarmFontCallsOptions,
): Promise<TransformFarmFontCallsResult | null> {
  const cleanId = options.id.split("?", 1)[0];
  if (
    !MODULE_EXTENSION_RE.test(cleanId) ||
    /\.d\.[cm]?ts$/.test(cleanId) ||
    !containsFontFunction(options.code)
  ) {
    return null;
  }

  const ast = options.parse(options.code);
  const bindings = findFontBindings(ast);
  if (bindings.named.size === 0 && bindings.namespaces.size === 0) return null;

  const calls = findFontCalls(ast, bindings);
  if (calls.length === 0) return null;
  validateFontBindingReferences(ast, calls, cleanId);

  const registeredCalls = calls.map((call) => ({
    kind: call.kind,
    options: readFontOptions(options.code, cleanId, call),
  }));
  const fonts = await options.register(cleanId, registeredCalls);
  const replacements: Replacement[] = calls.map((call, index) => ({
    start: call.node.start,
    end: call.node.end,
    code: serializeFontResult(fonts[index]),
  }));
  replacements.push(
    ...createFontImportReplacements(
      options.code,
      ast,
      new Set(calls.map((call) => call.binding).filter((value): value is string => Boolean(value))),
    ),
  );
  const imports = options.production
    ? ""
    : Array.from(new Set(fonts.map((font) => font.id)))
        .map((id) => `import ${JSON.stringify(`virtual:farm-font-css/${id}.css`)};`)
        .join("\n");

  return {
    code: `${applyReplacements(options.code, replacements)}\n${imports}\n`,
    fonts,
  };
}

export function renderFarmFontDevHead(root: string): string {
  const registry = registries.get(normalizeRoot(root));
  if (!registry || registry.production || registry.size === 0) return "";
  return registry.renderPreloadTags(false);
}

class FarmFontRegistry {
  root: string;
  basePath: string;
  publicDir: string | false;
  production = false;
  private modules = new Map<string, FontDefinition[]>();
  private definitions = new Map<string, FontDefinition>();
  private resources = new Map<string, FontResource>();

  constructor(root: string, basePath = "/", publicDir?: string | false) {
    this.root = root;
    this.basePath = normalizeBasePath(basePath);
    this.publicDir = normalizePublicDir(root, publicDir);
  }

  get size(): number {
    return this.getDefinitions().length;
  }

  async register(
    moduleId: string,
    calls: Array<{ kind: FontLoaderKind; options: Record<string, unknown> }>,
    production: boolean,
  ): Promise<FontDefinition[]> {
    const definitions: FontDefinition[] = [];
    for (const call of calls) {
      definitions.push(await this.createDefinition(moduleId, call.kind, call.options, production));
    }
    this.modules.set(moduleId, definitions);
    for (const definition of definitions) this.definitions.set(definition.id, definition);
    return definitions;
  }

  clearModule(moduleId: string): void {
    this.modules.delete(moduleId);
  }

  renderFontCss(id: string, production: boolean): string {
    const definition = this.definitions.get(id);
    return definition ? renderFontDefinitionCss(definition, production, this.basePath) : "";
  }

  renderCss(production: boolean): string {
    const css = this.getDefinitions()
      .map((definition) => renderFontDefinitionCss(definition, production, this.basePath))
      .join("\n\n");
    return css ? `${FONT_SECTION_START}\n${css}\n${FONT_SECTION_END}\n` : "";
  }

  renderPreloadHeader(production: boolean): string {
    return this.getPreloadResources(production)
      .map(
        ({ url, resource }) =>
          `<${url}>; rel=preload; as=font; type=${fontContentType(resource.extension)}; crossorigin`,
      )
      .join(", ");
  }

  renderPreloadTags(production: boolean): string {
    return this.getPreloadResources(production)
      .map(
        ({ url, resource }) =>
          `<link rel="preload" href="${escapeHtmlAttribute(url)}" as="font" type="${fontContentType(resource.extension)}" crossorigin>`,
      )
      .join("\n  ");
  }

  getDevResource(pathname: string): FontResource | undefined {
    for (const resource of this.getActiveResources()) {
      if (resource.bytes && resourceUrl(resource, false, this.basePath) === pathname) {
        return resource;
      }
    }
    return undefined;
  }

  emitAssets(context: { emitFile: (file: any) => string }, bundle: OutputBundle): void {
    for (const resource of this.getActiveResources()) {
      if (!resource.bytes || !resource.outputFileName) continue;
      if (bundle[resource.outputFileName]) continue;
      context.emitFile({
        type: "asset",
        fileName: resource.outputFileName,
        source: resource.bytes,
      });
    }

    const css = this.renderCss(true);
    if (css) {
      const cssAssets = Object.values(bundle).filter(
        (entry): entry is OutputAsset => entry.type === "asset" && entry.fileName.endsWith(".css"),
      );
      const clientCss =
        cssAssets.find(
          (entry): entry is OutputAsset =>
            entry.type === "asset" && entry.fileName === "farm-client.css",
        ) ?? (cssAssets.length === 1 ? cssAssets[0] : undefined);
      if (clientCss) {
        clientCss.source = replaceFontSection(assetSourceToString(clientCss.source), css);
      } else if (!bundle["farm-fonts.css"]) {
        context.emitFile({
          type: "asset",
          fileName: "farm-fonts.css",
          source: css,
        });
      }
    }

    const preloadHeader = encodeURIComponent(this.renderPreloadHeader(true));
    for (const entry of Object.values(bundle)) {
      if (entry.type === "chunk" && entry.code.includes(PRELOAD_HEADER_MARKER)) {
        entry.code = entry.code.split(PRELOAD_HEADER_MARKER).join(preloadHeader);
      }
    }
  }

  private getDefinitions(): FontDefinition[] {
    const active = new Map<string, FontDefinition>();
    for (const definitions of this.modules.values()) {
      for (const definition of definitions) active.set(definition.id, definition);
    }
    return Array.from(active.values()).sort((left, right) => left.id.localeCompare(right.id));
  }

  private getActiveResources(): FontResource[] {
    const active = new Set<FontResource>();
    for (const definition of this.getDefinitions()) {
      for (const source of definition.sources) active.add(source.resource);
    }
    return Array.from(active);
  }

  private getPreloadResources(production: boolean) {
    const seen = new Set<string>();
    const resources: Array<{ url: string; resource: FontResource }> = [];
    for (const definition of this.getDefinitions()) {
      if (!definition.preload) continue;
      for (const source of definition.sources) {
        const url = resourceUrl(source.resource, production, this.basePath);
        if (seen.has(url)) continue;
        seen.add(url);
        resources.push({ url, resource: source.resource });
      }
    }
    return resources;
  }

  private async createDefinition(
    moduleId: string,
    kind: FontLoaderKind,
    raw: Record<string, unknown>,
    production: boolean,
  ): Promise<FontDefinition> {
    validateOptionKeys(moduleId, kind, raw);
    const family = requireString(raw.family, moduleId, `${kind}() family`);
    const display = (raw.display ?? "swap") as FarmFontDisplay;
    if (!["auto", "block", "swap", "fallback", "optional"].includes(display)) {
      throw fontError(moduleId, `invalid font-display value ${JSON.stringify(display)}`);
    }
    const variable = optionalString(raw.variable, moduleId, `${kind}() variable`);
    if (variable && !/^--[A-Za-z_][\w-]*$/.test(variable)) {
      throw fontError(moduleId, `font variable must be a CSS custom property such as --font-sans`);
    }
    const fallback = readStringArray(raw.fallback, moduleId, `${kind}() fallback`);
    const defaultWeight = optionalWeight(raw.weight, moduleId);
    const defaultStyle = optionalCssDescriptor(raw.style, moduleId, "style") || "normal";
    const sources = readSources(raw.src, moduleId, kind, defaultWeight, defaultStyle);
    const strategy = kind === "remoteFont" ? (raw.strategy ?? "self-host") : "self-host";
    if (strategy !== "self-host" && strategy !== "external") {
      throw fontError(moduleId, `remoteFont() strategy must be "self-host" or "external"`);
    }
    const integrity = optionalString(raw.integrity, moduleId, `${kind}() integrity`);

    const normalizedSources: NormalizedFontSource[] = [];
    for (const source of sources) {
      const resource = await this.resolveResource({
        kind,
        moduleId,
        source: source.path,
        strategy,
        integrity: source.integrity ?? integrity,
        production,
      });
      normalizedSources.push({
        source: source.path,
        weight: String(source.weight ?? defaultWeight ?? "400"),
        style: source.style || defaultStyle,
        unicodeRange: source.unicodeRange,
        resource,
      });
    }

    const identity = JSON.stringify({
      family,
      display,
      variable,
      fallback,
      preload: raw.preload !== false,
      sources: normalizedSources.map((source) => ({
        hash: source.resource.hash,
        url: source.resource.publicUrl,
        weight: source.weight,
        style: source.style,
        unicodeRange: source.unicodeRange,
      })),
    });
    const id = createHash("sha256").update(identity).digest("hex").slice(0, 10);

    return {
      id,
      family,
      className: `farm-font-${id}`,
      variableClassName: variable ? `farm-font-variable-${id}` : "",
      variable,
      fallback,
      display,
      preload: raw.preload !== false,
      weight: defaultWeight,
      style: raw.style === undefined ? undefined : defaultStyle,
      sources: normalizedSources,
    };
  }

  private async resolveResource(input: {
    kind: FontLoaderKind;
    moduleId: string;
    source: string;
    strategy: unknown;
    integrity?: string;
    production: boolean;
  }): Promise<FontResource> {
    if (input.kind === "remoteFont") {
      let url: URL;
      try {
        url = new URL(input.source);
      } catch {
        throw fontError(input.moduleId, `remoteFont() source must be an absolute HTTPS URL`);
      }
      if (url.protocol !== "https:") {
        throw fontError(input.moduleId, `remoteFont() only accepts HTTPS URLs`);
      }
      const extension = extensionFromPath(url.pathname);
      if (input.strategy === "external") {
        const hash = createHash("sha256").update(url.href).digest("hex").slice(0, 12);
        const resource = {
          extension,
          format: fontFormat(extension),
          hash,
          publicUrl: url.href,
        };
        this.resources.set(`external:${url.href}`, resource);
        return resource;
      }

      const bytes = await fetchRemoteFont(url, input.integrity);
      return this.createSelfHostedResource(bytes, extension, path.basename(url.pathname));
    }

    if (input.source.startsWith("/")) {
      return this.createPublicResource(input.moduleId, input.source);
    }

    const resolvedPath = resolveLocalFontPath(input.source, input.moduleId, this.root);
    if (!FONT_EXTENSION_RE.test(resolvedPath)) {
      throw fontError(
        input.moduleId,
        `unsupported local font file ${JSON.stringify(input.source)}`,
      );
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(resolvedPath);
    } catch (error) {
      throw fontError(
        input.moduleId,
        `could not read ${JSON.stringify(input.source)}: ${(error as Error).message}`,
      );
    }
    return this.createSelfHostedResource(
      bytes,
      path.extname(resolvedPath),
      path.basename(resolvedPath),
    );
  }

  private async createPublicResource(moduleId: string, source: string): Promise<FontResource> {
    if (!this.publicDir) {
      throw fontError(
        moduleId,
        `cannot resolve ${JSON.stringify(source)} because publicDir is disabled`,
      );
    }
    const publicPath = normalizePublicFontPath(source, moduleId);
    const resolvedPath = path.resolve(this.publicDir, `.${publicPath}`);
    if (!isPathInside(this.publicDir, resolvedPath)) {
      throw fontError(moduleId, `public font path must stay inside publicDir`);
    }
    if (!FONT_EXTENSION_RE.test(resolvedPath)) {
      throw fontError(moduleId, `unsupported public font file ${JSON.stringify(source)}`);
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(resolvedPath);
    } catch (error) {
      throw fontError(
        moduleId,
        `could not read ${JSON.stringify(source)} from publicDir: ${(error as Error).message}`,
      );
    }

    const extension = path.extname(resolvedPath).toLowerCase();
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const resource: FontResource = {
      extension,
      format: fontFormat(extension),
      hash,
      publicPath,
      publicUrl: "",
    };
    this.resources.set(`public:${publicPath}`, resource);
    return resource;
  }

  private createSelfHostedResource(
    bytes: Buffer,
    extension: string,
    fileName: string,
  ): FontResource {
    const normalizedExtension = extension.toLowerCase();
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const baseName = sanitizeFileName(path.basename(fileName, extension)) || "font";
    const outputFileName = `assets/fonts/${baseName}-${hash}${normalizedExtension}`;
    const key = `${hash}${normalizedExtension}`;
    const existing = this.resources.get(key);
    if (existing) return existing;

    const resource: FontResource = {
      bytes,
      extension: normalizedExtension,
      format: fontFormat(normalizedExtension),
      hash,
      outputFileName,
      publicUrl: "",
    };
    this.resources.set(key, resource);
    return resource;
  }
}

function findFontBindings(ast: AstNode) {
  const named = new Map<string, FontLoaderKind>();
  const namespaces = new Set<string>();
  const body = Array.isArray(ast.body) ? ast.body : [];

  for (const statement of body) {
    if (!isAstNode(statement) || statement.type !== "ImportDeclaration") continue;
    const source = isAstNode(statement.source) ? statement.source.value : undefined;
    if (typeof source !== "string" || !FONT_IMPORTS.has(source)) continue;

    const specifiers = Array.isArray(statement.specifiers) ? statement.specifiers : [];
    for (const specifier of specifiers) {
      if (!isAstNode(specifier) || !isAstNode(specifier.local)) continue;
      const localName = specifier.local.name;
      if (typeof localName !== "string") continue;
      if (specifier.type === "ImportNamespaceSpecifier") {
        namespaces.add(localName);
        continue;
      }
      if (specifier.type !== "ImportSpecifier" || !isAstNode(specifier.imported)) continue;
      const importedName = specifier.imported.name ?? specifier.imported.value;
      if (isFontLoaderKind(importedName)) named.set(localName, importedName);
    }
  }
  return { named, namespaces };
}

function findFontCalls(ast: AstNode, bindings: ReturnType<typeof findFontBindings>): FontCall[] {
  const calls: FontCall[] = [];
  walkAst(ast, (node, ancestors) => {
    if (node.type !== "CallExpression" || !isAstNode(node.callee)) return;
    let kind: FontLoaderKind | undefined;
    if (node.callee.type === "Identifier" && typeof node.callee.name === "string") {
      kind = bindings.named.get(node.callee.name);
      if (kind) calls.push({ kind, binding: node.callee.name, node, ancestors });
    } else if (
      node.callee.type === "MemberExpression" &&
      node.callee.computed !== true &&
      isAstNode(node.callee.object) &&
      isAstNode(node.callee.property) &&
      node.callee.object.type === "Identifier" &&
      node.callee.property.type === "Identifier" &&
      typeof node.callee.object.name === "string" &&
      typeof node.callee.property.name === "string" &&
      bindings.namespaces.has(node.callee.object.name) &&
      isFontLoaderKind(node.callee.property.name)
    ) {
      kind = node.callee.property.name;
    }
    if (kind && node.callee.type !== "Identifier") calls.push({ kind, node, ancestors });
  });
  return calls;
}

function validateFontBindingReferences(ast: AstNode, calls: FontCall[], id: string): void {
  const calledBindings = new Set(
    calls.map((call) => call.binding).filter((binding): binding is string => Boolean(binding)),
  );
  const transformedCallees = new Set(
    calls.flatMap((call) => {
      const callee = call.node.callee;
      return call.binding && isAstNode(callee) ? [`${callee.start}:${callee.end}`] : [];
    }),
  );

  walkAst(ast, (node, ancestors) => {
    if (
      node.type !== "Identifier" ||
      typeof node.name !== "string" ||
      !calledBindings.has(node.name)
    ) {
      return;
    }
    const parent = ancestors.at(-1);
    if (!parent || isNonReferenceIdentifier(node, parent)) return;
    if (transformedCallees.has(`${node.start}:${node.end}`)) return;
    throw fontError(
      id,
      `${node.name} can only be referenced by statically compiled font declarations`,
    );
  });
}

function isNonReferenceIdentifier(node: AstNode, parent: AstNode): boolean {
  if (parent.type === "ImportSpecifier") return true;
  if (
    (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
    parent.property === node &&
    parent.computed !== true
  ) {
    return true;
  }
  if (
    (parent.type === "Property" || parent.type === "PropertyDefinition") &&
    parent.key === node &&
    parent.computed !== true &&
    parent.shorthand !== true
  ) {
    return true;
  }
  return false;
}

function createFontImportReplacements(
  code: string,
  ast: AstNode,
  calledBindings: ReadonlySet<string>,
): Replacement[] {
  if (calledBindings.size === 0) return [];
  const replacements: Replacement[] = [];
  const body = Array.isArray(ast.body) ? ast.body : [];

  for (const statement of body) {
    if (!isAstNode(statement) || statement.type !== "ImportDeclaration") continue;
    const source = isAstNode(statement.source) ? statement.source.value : undefined;
    if (typeof source !== "string" || !FONT_IMPORTS.has(source)) continue;
    const specifiers = (Array.isArray(statement.specifiers) ? statement.specifiers : []).filter(
      isAstNode,
    );
    const retained = specifiers.filter((specifier) => {
      if (specifier.type !== "ImportSpecifier" || !isAstNode(specifier.local)) return true;
      return typeof specifier.local.name !== "string" || !calledBindings.has(specifier.local.name);
    });
    if (retained.length === specifiers.length) continue;

    replacements.push({
      start: statement.start,
      end: statement.end,
      code: renderImportDeclaration(code, source, retained),
    });
  }

  return replacements;
}

function renderImportDeclaration(code: string, source: string, specifiers: AstNode[]): string {
  if (specifiers.length === 0) return "";
  const defaultSpecifier = specifiers.find(
    (specifier) => specifier.type === "ImportDefaultSpecifier",
  );
  const namespaceSpecifier = specifiers.find(
    (specifier) => specifier.type === "ImportNamespaceSpecifier",
  );
  const namedSpecifiers = specifiers.filter((specifier) => specifier.type === "ImportSpecifier");
  const parts: string[] = [];

  if (defaultSpecifier && isAstNode(defaultSpecifier.local)) {
    parts.push(code.slice(defaultSpecifier.local.start, defaultSpecifier.local.end));
  }
  if (namespaceSpecifier && isAstNode(namespaceSpecifier.local)) {
    parts.push(`* as ${code.slice(namespaceSpecifier.local.start, namespaceSpecifier.local.end)}`);
  }
  if (namedSpecifiers.length > 0) {
    parts.push(
      `{ ${namedSpecifiers.map((specifier) => code.slice(specifier.start, specifier.end)).join(", ")} }`,
    );
  }

  return parts.length > 0 ? `import ${parts.join(", ")} from ${JSON.stringify(source)};` : "";
}

function readFontOptions(code: string, id: string, call: FontCall): Record<string, unknown> {
  if (!call.binding) {
    throw fontError(id, `${call.kind}() must use a named import from @farm.js/core/font`);
  }
  const args = Array.isArray(call.node.arguments) ? call.node.arguments : [];
  if (args.length !== 1 || !isAstNode(args[0]) || args[0].type !== "ObjectExpression") {
    throw fontError(id, `${call.kind}() requires one inline options object`);
  }
  const parent = call.ancestors.at(-1);
  if (!parent || parent.type !== "VariableDeclarator" || parent.init !== call.node) {
    throw fontError(id, `${call.kind}() must initialize a module-scope variable`);
  }
  const declaration = call.ancestors.at(-2);
  const statement = call.ancestors.at(-3);
  const statementParent = call.ancestors.at(-4);
  const isModuleScope =
    declaration?.type === "VariableDeclaration" &&
    (statement?.type === "Program" ||
      (statement?.type === "ExportNamedDeclaration" && statementParent?.type === "Program"));
  if (!isModuleScope || call.ancestors.some((ancestor) => isFunctionNode(ancestor))) {
    throw fontError(id, `${call.kind}() must be declared directly at module scope`);
  }
  return evaluateStaticObject(code, id, args[0]);
}

function evaluateStaticObject(code: string, id: string, node: AstNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const properties = Array.isArray(node.properties) ? node.properties : [];
  for (const property of properties) {
    if (!isAstNode(property) || property.type !== "Property" || property.computed === true) {
      throw fontError(id, "font options do not support spreads or computed properties");
    }
    const key = readPropertyName(property.key);
    if (!key || !isAstNode(property.value)) {
      throw fontError(id, "font options must use static property names and values");
    }
    result[key] = evaluateStaticValue(code, id, property.value);
  }
  return result;
}

function evaluateStaticValue(code: string, id: string, node: AstNode): unknown {
  if (node.type === "Literal") return node.value;
  if (node.type === "TemplateLiteral") {
    const expressions = Array.isArray(node.expressions) ? node.expressions : [];
    const quasis = Array.isArray(node.quasis) ? node.quasis : [];
    if (expressions.length === 0 && quasis.length === 1 && isAstNode(quasis[0])) {
      const templateValue = quasis[0].value;
      const value =
        templateValue && typeof templateValue === "object"
          ? (templateValue as { cooked?: unknown }).cooked
          : undefined;
      if (typeof value === "string") return value;
    }
  }
  if (node.type === "ArrayExpression") {
    const elements = Array.isArray(node.elements) ? node.elements : [];
    return elements.map((element) => {
      if (!isAstNode(element) || element.type === "SpreadElement") {
        throw fontError(id, "font option arrays must contain static values");
      }
      return evaluateStaticValue(code, id, element);
    });
  }
  if (node.type === "ObjectExpression") return evaluateStaticObject(code, id, node);
  if (
    node.type === "UnaryExpression" &&
    (node.operator === "+" || node.operator === "-") &&
    isAstNode(node.argument)
  ) {
    const value = evaluateStaticValue(code, id, node.argument);
    if (typeof value === "number") return node.operator === "-" ? -value : value;
  }
  throw fontError(
    id,
    `font options must be statically analyzable near ${code.slice(node.start, node.end)}`,
  );
}

function readSources(
  value: unknown,
  id: string,
  kind: FontLoaderKind,
  weight: number | string | undefined,
  style: string,
): Array<FarmFontSource & Pick<RemoteFontSource, "integrity">> {
  if (typeof value === "string") return [{ path: value, weight, style }];
  if (!Array.isArray(value) || value.length === 0) {
    throw fontError(id, `${kind}() src must be a string or a non-empty source array`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw fontError(id, `${kind}() src[${index}] must be an object`);
    }
    const source = entry as Record<string, unknown>;
    const unknown = Object.keys(source).filter(
      (key) =>
        ![
          "path",
          "weight",
          "style",
          "unicodeRange",
          ...(kind === "remoteFont" ? ["integrity"] : []),
        ].includes(key),
    );
    if (unknown.length) throw fontError(id, `unknown src[${index}] option ${unknown[0]}`);
    return {
      path: requireString(source.path, id, `${kind}() src[${index}].path`),
      weight: optionalWeight(source.weight, id) ?? weight,
      style: optionalCssDescriptor(source.style, id, "style") || style,
      unicodeRange: optionalUnicodeRange(source.unicodeRange, id),
      integrity: optionalString(source.integrity, id, `${kind}() src[${index}].integrity`),
    };
  });
}

function validateOptionKeys(id: string, kind: FontLoaderKind, raw: Record<string, unknown>) {
  const allowed = new Set([
    "src",
    "family",
    "weight",
    "style",
    "display",
    "variable",
    "fallback",
    "preload",
    ...(kind === "remoteFont" ? ["strategy", "integrity"] : []),
  ]);
  const unknown = Object.keys(raw).find((key) => !allowed.has(key));
  if (unknown) throw fontError(id, `unknown ${kind}() option ${JSON.stringify(unknown)}`);
  if (typeof raw.preload !== "undefined" && typeof raw.preload !== "boolean") {
    throw fontError(id, `${kind}() preload must be a boolean`);
  }
}

function serializeFontResult(font: FontDefinition): string {
  const stack = renderFamilyStack(font.family, font.fallback);
  return JSON.stringify({
    className: font.className,
    variable: font.variableClassName,
    style: {
      fontFamily: stack,
      ...(font.style ? { fontStyle: font.style } : {}),
      ...(font.weight !== undefined && !String(font.weight).includes(" ")
        ? { fontWeight: font.weight }
        : {}),
    },
  });
}

function renderFontDefinitionCss(
  font: FontDefinition,
  production: boolean,
  basePath: string,
): string {
  const faces = font.sources.map((source) => {
    const descriptors = [
      `  font-family: ${quoteCssString(font.family)};`,
      `  src: url(${quoteCssString(resourceUrl(source.resource, production, basePath))}) format(${quoteCssString(source.resource.format)});`,
      `  font-display: ${font.display};`,
      `  font-weight: ${source.weight};`,
      `  font-style: ${source.style};`,
      ...(source.unicodeRange ? [`  unicode-range: ${source.unicodeRange};`] : []),
    ];
    return `@font-face {\n${descriptors.join("\n")}\n}`;
  });
  const stack = renderFamilyStack(font.family, font.fallback);
  faces.push(`.${font.className} {\n  font-family: ${stack};\n}`);
  if (font.variable && font.variableClassName) {
    faces.push(`.${font.variableClassName} {\n  ${font.variable}: ${stack};\n}`);
  }
  return faces.join("\n\n");
}

function resourceUrl(resource: FontResource, production: boolean, basePath: string): string {
  if (resource.publicPath) {
    return production ? joinBasePath(basePath, resource.publicPath) : resource.publicPath;
  }
  if (!resource.bytes) return resource.publicUrl;
  if (!production) {
    return joinBasePath(basePath, `/@farm/font/${resource.hash}${resource.extension}`);
  }
  return joinBasePath(basePath, `/${resource.outputFileName}`);
}

async function fetchRemoteFont(url: URL, integrity?: string): Promise<Buffer> {
  const key = `${url.href}\0${integrity || ""}`;
  let pending = remoteBytes.get(key);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url, {
        headers: { "User-Agent": "Farm.js font compiler" },
        redirect: "follow",
      });
      if (!response.ok)
        throw new Error(`request returned ${response.status} ${response.statusText}`);
      const length = Number(response.headers.get("content-length") || 0);
      if (length > MAX_REMOTE_FONT_BYTES) throw new Error("font exceeds the 20 MB limit");
      const bytes = await readResponseBodyWithLimit(response, MAX_REMOTE_FONT_BYTES);
      if (integrity) verifyIntegrity(bytes, integrity);
      return bytes;
    })().catch((error) => {
      throw new Error(`[Farm fonts] Failed to download ${url.href}: ${(error as Error).message}`);
    });
    remoteBytes.set(key, pending);
    const clearPending = () => {
      if (remoteBytes.get(key) === pending) remoteBytes.delete(key);
    };
    void pending.then(clearPending, clearPending);
  }
  return pending;
}

async function readResponseBodyWithLimit(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > limit) {
      await reader.cancel("font exceeds the configured byte limit");
      throw new Error("font exceeds the 20 MB limit");
    }
    chunks.push(chunk.value);
  }

  return Buffer.concat(chunks, total);
}

function verifyIntegrity(bytes: Buffer, integrity: string): void {
  const entries = integrity.trim().split(/\s+/);
  const supported = entries
    .map((entry) => entry.match(/^(sha(?:256|384|512))-(.+)$/))
    .filter((entry): entry is RegExpMatchArray => Boolean(entry));
  if (supported.length === 0) throw new Error("integrity must use sha256, sha384, or sha512");
  const matches = supported.some((entry) => {
    const actual = createHash(entry[1]).update(bytes).digest();
    const expected = Buffer.from(entry[2], "base64");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!matches) throw new Error("downloaded font did not match its integrity value");
}

function resolveLocalFontPath(source: string, importer: string, root: string): string {
  if (source.startsWith(".")) return path.resolve(path.dirname(importer), source);
  if (path.isAbsolute(source)) {
    return source;
  }
  try {
    return createRequire(pathToFileURL(importer)).resolve(source);
  } catch {
    const segments = source.replace(/\\/g, "/").split("/");
    if (segments.includes("..")) return path.resolve(root, source);

    let current = path.dirname(importer);
    const filesystemRoot = path.parse(current).root;
    while (true) {
      const candidate = path.join(current, "node_modules", ...segments);
      if (existsSync(candidate)) return candidate;
      if (current === filesystemRoot) break;
      current = path.dirname(current);
    }
    return path.resolve(root, "node_modules", ...segments);
  }
}

function replaceFontSection(css: string, section: string): string {
  const start = css.indexOf(FONT_SECTION_START);
  const end = css.indexOf(FONT_SECTION_END);
  const withoutExisting =
    start >= 0 && end >= start
      ? `${css.slice(0, start)}${css.slice(end + FONT_SECTION_END.length)}`.trimEnd()
      : css.trimEnd();
  return `${withoutExisting}${withoutExisting ? "\n\n" : ""}${section}`;
}

export function mergeFarmFontCss(clientCss: string, fontCss: string): string {
  return replaceFontSection(clientCss, fontCss);
}

function getOrCreateRegistry(
  root: string,
  basePath = "/",
  publicDir?: string | false,
): FarmFontRegistry {
  const normalized = normalizeRoot(root);
  const existing = registries.get(normalized);
  if (existing) {
    existing.basePath = normalizeBasePath(basePath);
    existing.publicDir = normalizePublicDir(normalized, publicDir);
    return existing;
  }
  const registry = new FarmFontRegistry(normalized, basePath, publicDir);
  registries.set(normalized, registry);
  return registry;
}

function getGlobalMap<TKey, TValue>(key: symbol): Map<TKey, TValue> {
  const runtime = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = runtime[key];
  if (existing instanceof Map) return existing as Map<TKey, TValue>;
  const created = new Map<TKey, TValue>();
  runtime[key] = created;
  return created;
}

function normalizeRoot(root: string): string {
  return path.resolve(root).replace(/\\/g, "/");
}

function normalizePublicDir(root: string, publicDir?: string | false): string | false {
  if (publicDir === false || publicDir === "") return false;
  return path.resolve(root, publicDir || "public");
}

function normalizePublicFontPath(source: string, moduleId: string): string {
  if (source.includes("?") || source.includes("#")) {
    throw fontError(moduleId, `public font paths cannot contain a query string or fragment`);
  }
  return `/${source.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeBasePath(value: string): string {
  if (!value || value === "/") return "/";
  return `/${value.replace(/^\/+|\/+$/g, "")}/`;
}

function joinBasePath(basePath: string, value: string): string {
  return basePath === "/" ? value : `${basePath.replace(/\/$/, "")}${value}`;
}

function extensionFromPath(pathname: string): string {
  const extension = path.extname(pathname).toLowerCase();
  if (!FONT_EXTENSION_RE.test(extension)) {
    throw new Error(`[Farm fonts] Remote font URL must end in .woff2, .woff, .ttf, or .otf`);
  }
  return extension;
}

function fontFormat(extension: string): string {
  switch (extension.toLowerCase()) {
    case ".woff2":
      return "woff2";
    case ".woff":
      return "woff";
    case ".ttf":
      return "truetype";
    case ".otf":
      return "opentype";
    default:
      throw new Error(`[Farm fonts] Unsupported font extension ${extension}`);
  }
}

function fontContentType(extension: string): string {
  switch (extension.toLowerCase()) {
    case ".woff2":
      return "font/woff2";
    case ".woff":
      return "font/woff";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    default:
      return "application/octet-stream";
  }
}

function renderFamilyStack(family: string, fallback: string[]): string {
  return [quoteCssString(family), ...fallback.map(formatFallbackFamily)].join(", ");
}

function formatFallbackFamily(value: string): string {
  return /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|emoji|math|fangsong)$/.test(
    value,
  )
    ? value
    : quoteCssString(value);
}

function quoteCssString(value: string): string {
  return JSON.stringify(value.replace(/[\n\r\f]/g, " "));
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function assetSourceToString(source: string | Uint8Array): string {
  return typeof source === "string" ? source : Buffer.from(source).toString("utf8");
}

function applyReplacements(code: string, replacements: Replacement[]): string {
  let output = code;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.code + output.slice(replacement.end);
  }
  return output;
}

function walkAst(
  node: AstNode,
  visit: (node: AstNode, ancestors: readonly AstNode[]) => void,
  ancestors: readonly AstNode[] = [],
): void {
  visit(node, ancestors);
  const childAncestors = [...ancestors, node];
  for (const [key, value] of Object.entries(node)) {
    if (["start", "end", "loc", "range"].includes(key)) continue;
    if (isAstNode(value)) walkAst(value, visit, childAncestors);
    else if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) walkAst(item, visit, childAncestors);
    }
  }
}

function readPropertyName(value: unknown): string | undefined {
  if (!isAstNode(value)) return undefined;
  if (value.type === "Identifier" && typeof value.name === "string") return value.name;
  if (value.type === "Literal" && typeof value.value === "string") return value.value;
  return undefined;
}

function isAstNode(value: unknown): value is AstNode {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as AstNode).type === "string" &&
    typeof (value as AstNode).start === "number" &&
    typeof (value as AstNode).end === "number"
  );
}

function isFunctionNode(node: AstNode): boolean {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function isFontLoaderKind(value: unknown): value is FontLoaderKind {
  return typeof value === "string" && FONT_FUNCTIONS.has(value as FontLoaderKind);
}

function containsFontFunction(code: string): boolean {
  return Array.from(FONT_FUNCTIONS).some((name) => code.includes(name));
}

function requireString(value: unknown, id: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw fontError(id, `${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, id: string, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, id, label);
}

function readStringArray(value: unknown, id: string, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw fontError(id, `${label} must be an array of family names`);
  }
  return value as string[];
}

function optionalWeight(value: unknown, id: string): number | string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1000) {
    return value;
  }
  if (
    typeof value === "string" &&
    /^(?:[1-9]\d{0,2}|1000)(?:\s+(?:[1-9]\d{0,2}|1000))?$/.test(value)
  ) {
    const bounds = value.split(/\s+/).map(Number);
    if (bounds.length === 2 && bounds[0] > bounds[1]) {
      throw fontError(id, `font weight range must be ordered from lowest to highest`);
    }
    return value;
  }
  throw fontError(id, `font weight must be a number or range such as "100 900"`);
}

function optionalCssDescriptor(value: unknown, id: string, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9 .-]+$/.test(value)) {
    throw fontError(id, `font ${label} contains unsupported characters`);
  }
  return value;
}

function optionalUnicodeRange(value: unknown, id: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[Uu+0-9A-Fa-f?*, -]+$/.test(value)) {
    throw fontError(id, `font unicodeRange contains unsupported characters`);
  }
  return value;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function fontError(id: string, message: string): Error {
  return new Error(`[Farm fonts] ${message} in ${id.split("?", 1)[0]}`);
}
