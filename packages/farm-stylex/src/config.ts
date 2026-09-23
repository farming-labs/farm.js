import type { UserOptions } from "@stylexjs/unplugin";

type FarmManagedStyleXOption = "dev" | "devMode" | "devPersistToDisk";

/** StyleX compiler options. Farm owns the development mode and browser hookup. */
export type StyleXOptions = Omit<
  Partial<UserOptions>,
  FarmManagedStyleXOption | "externalPackages"
> & {
  /**
   * Packages in `node_modules` that publish uncompiled StyleX source.
   * Farm de-optimizes and compiles these packages as application source.
   */
  externalPackages?: readonly string[];
};

export interface ResolvedStyleXOptions extends Omit<StyleXOptions, "externalPackages"> {
  externalPackages: string[];
}

export function resolveStylexOptions(options: StyleXOptions = {}): ResolvedStyleXOptions {
  const externalPackages = options.externalPackages ?? [];
  if (!Array.isArray(externalPackages)) {
    throw new TypeError("[farm:stylex] externalPackages must be an array of package names");
  }

  const normalizedPackages: string[] = [];
  for (const value of externalPackages) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError("[farm:stylex] externalPackages must contain non-empty package names");
    }
    const packageName = value.trim();
    if (!isPackageName(packageName)) {
      throw new TypeError(
        `[farm:stylex] externalPackages must contain package names, not paths or subpath imports: ${JSON.stringify(value)}`,
      );
    }
    if (!normalizedPackages.includes(packageName)) normalizedPackages.push(packageName);
  }

  return { ...options, externalPackages: normalizedPackages };
}

function isPackageName(value: string): boolean {
  if (value.startsWith(".") || value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  return value.startsWith("@")
    ? segments.length === 2 && segments.every(Boolean)
    : segments.length === 1;
}
