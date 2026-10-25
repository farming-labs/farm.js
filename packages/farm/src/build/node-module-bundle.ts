import { isBuiltin } from "node:module";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { ExternalOption, Plugin } from "rolldown";

export interface BundleNodeModuleOptions {
  /** Working directory for resolution and diagnostics. */
  root: string;
  entry: string;
  outfile: string;
  /** Oxc target, for example `node22`. */
  target: string;
  /**
   * Leave package imports to Node at runtime, like esbuild's `packages: "external"`.
   * tsconfig `paths` aliases that resolve to local files are still bundled.
   */
  externalPackages?: boolean;
  external?: ExternalOption;
  plugins?: Plugin[];
}

// Relative, absolute (POSIX or Windows), subpath (`#x`) and virtual ids.
const NON_PACKAGE_SPECIFIER_RE = /^(?:[./\\#]|[A-Za-z]:[\\/])/;

function isPackageSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith("\0") &&
    !NON_PACKAGE_SPECIFIER_RE.test(specifier) &&
    !path.isAbsolute(specifier)
  );
}

// `.d.ts`, `.d.mts`, `.d.cts` and arbitrary-extension declarations such as `.d.css.ts`.
const DECLARATION_FILE_RE = /\.d\.(?:[^./\\]+\.)?[cm]?ts$/;

/**
 * Whether a resolved id is a TypeScript declaration file. Apps often point a
 * tsconfig `paths` entry at a workspace package's `dist/index.d.ts` for the
 * editor; esbuild ignored such matches and resolved the package normally, and
 * Rolldown's resolver must not be allowed to load them as runtime code.
 */
export function isDeclarationFile(id: string): boolean {
  return DECLARATION_FILE_RE.test(id.split("?", 1)[0]);
}

type PackageResolver = import("rolldown/experimental").ResolverFactory;
const packageResolvers = new Map<string, Promise<PackageResolver>>();

/**
 * Resolve a package specifier from `importer` with Node's lookup only: package
 * `exports` with the Node `import` or `require` conditions, then `main`/`module`,
 * and no tsconfig `paths`. Returns null when the package cannot be found.
 */
export async function resolvePackageWithoutTsconfig(
  source: string,
  importer: string,
  kind?: string,
): Promise<string | null> {
  const condition = kind === "require-call" ? "require" : "import";
  let resolver = packageResolvers.get(condition);
  if (!resolver) {
    resolver = import("rolldown/experimental").then(
      ({ ResolverFactory }) =>
        new ResolverFactory({
          conditionNames: [condition, "node", "default"],
          mainFields: ["main", "module"],
        }),
    );
    packageResolvers.set(condition, resolver);
  }
  const result = await (await resolver).async(path.dirname(importer), source);
  return result.path ?? null;
}

/**
 * Bundle a project-owned module (config, instrumentation, workflow) into one
 * ESM file Node can import. Uses the Rolldown build Vite already installs.
 */
export async function bundleNodeModule(options: BundleNodeModuleOptions): Promise<void> {
  const { rolldown } = await import("rolldown");
  const plugins = options.externalPackages ? [externalizePackagesPlugin()] : [];
  plugins.push(...(options.plugins ?? []));

  try {
    const bundle = await rolldown({
      cwd: options.root,
      input: options.entry,
      platform: "node",
      logLevel: "silent",
      external: options.external,
      plugins,
      // Package imports stay external by the path they were found at (as esbuild
      // did), so a workspace symlink is not mistaken for a local alias target.
      resolve: options.externalPackages ? { symlinks: false } : undefined,
      transform: { target: options.target, jsx: { runtime: "automatic" } },
    });
    try {
      await bundle.write({
        file: options.outfile,
        format: "esm",
        sourcemap: "inline",
        codeSplitting: false,
      });
    } finally {
      await bundle.close();
    }
  } catch (error) {
    throw withPlainDiagnostics(error);
  }
}

function externalizePackagesPlugin(): Plugin {
  return {
    name: "farm-externalize-packages",
    async resolveId(source, importer, extraOptions) {
      if (!importer || !isPackageSpecifier(source) || isBuiltin(source)) return null;

      // Like esbuild's `packages: "external"`, tsconfig `paths` are applied
      // first: an alias that lands on a project file is bundled. A `paths`
      // entry that points at a declaration file is a type-only alias, so the
      // package stays external by its specifier.
      const resolved = await this.resolve(source, importer, {
        kind: extraOptions.kind,
        skipSelf: true,
      });
      if (
        resolved &&
        !resolved.external &&
        !resolved.id.startsWith("\0") &&
        !resolved.id.split(/[\\/]/).includes("node_modules") &&
        !isDeclarationFile(resolved.id)
      ) {
        return resolved;
      }
      return { id: source, external: true };
    },
  };
}

// Rolldown always colors its diagnostics; config load errors are printed and
// asserted as plain text.
function withPlainDiagnostics(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  error.message = stripVTControlCharacters(error.message);
  if (typeof error.stack === "string") error.stack = stripVTControlCharacters(error.stack);
  return error;
}
