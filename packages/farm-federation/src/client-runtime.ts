export interface FederationRuntimeApi {
  loadRemote<T>(specifier: string): Promise<T | null>;
  preloadRemote(remotes: Array<{ nameOrAlias: string }>): Promise<unknown>;
}

export interface FederationClient {
  loadRemote<TModule>(specifier: string): Promise<TModule>;
  preloadRemote(remotes: string | string[]): Promise<void>;
}

export type FederationRuntimeLoader = () => Promise<FederationRuntimeApi>;

export function createFederationClient(
  loadRuntime: FederationRuntimeLoader,
  isBrowser: () => boolean = () => typeof window !== "undefined",
): FederationClient {
  let runtime: Promise<FederationRuntimeApi> | undefined;
  const getRuntime = () => {
    if (!isBrowser()) {
      throw new Error(
        "[farm:federation] Remote browser modules must be loaded after hydration, for example inside an effect or event handler.",
      );
    }
    if (!runtime) {
      const loading = loadRuntime().catch((error) => {
        runtime = undefined;
        throw error;
      });
      runtime = loading;
    }
    return runtime;
  };

  return {
    async loadRemote<TModule>(specifier: string): Promise<TModule> {
      const normalized = normalizeSpecifier(specifier);
      const module = await (await getRuntime()).loadRemote<TModule>(normalized);
      if (module === null) {
        throw new Error(
          `[farm:federation] Remote module ${JSON.stringify(normalized)} was not found`,
        );
      }
      return module;
    },

    async preloadRemote(remotes: string | string[]): Promise<void> {
      const values = (Array.isArray(remotes) ? remotes : [remotes]).map(normalizeRemoteName);
      if (values.length === 0)
        throw new TypeError("Federation preload requires at least one remote");
      await (await getRuntime()).preloadRemote(values.map((nameOrAlias) => ({ nameOrAlias })));
    },
  };
}

function normalizeSpecifier(value: string): string {
  const specifier = normalizeRemoteName(value);
  if (!specifier.includes("/") || specifier.endsWith("/")) {
    throw new TypeError("Federation module specifier must contain a remote and exposed module");
  }
  return specifier;
}

function normalizeRemoteName(value: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /\s|[?#\\]/.test(value) ||
    hasControlCharacter(value)
  ) {
    throw new TypeError("Federation remote names must be non-empty module specifiers");
  }
  return value.trim();
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
