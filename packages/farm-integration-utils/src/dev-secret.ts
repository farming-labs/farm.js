// No static node:* imports: auth0 and workos ship to edge targets, and only the development path
// touches the filesystem. Node loads its builtins on demand there through getBuiltinModule.

/** Set by Farm while it evaluates an app's farm.config, which can live outside the cwd. */
const FARM_CONFIG_ROOT = Symbol.for("farm.configRoot");

/** Secrets for a process that cannot keep one on disk, by file path. */
const ephemeralSecrets = new Map<string, string>();

type NodeFs = typeof import("node:fs");
type NodePath = typeof import("node:path");

/**
 * A random development secret for an integration that signs or seals cookies, in place of a
 * constant fallback that anyone reaching a dev server (a `farm preview` URL, `--host`) could use
 * to forge sessions.
 *
 * Development generates 32 random bytes once per app in `<root>/.farm/<name>-secret`, which is
 * gitignored and denied to the dev file server, and reuses it so sessions survive restarts. Tests,
 * runtimes without a filesystem, and a directory that cannot be written get a random secret for
 * the life of the process. Call it only after deciding the environment is development:
 * production still needs a real one.
 */
export function resolveDevelopmentSecret(name: string, options: { root?: string } = {}): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new TypeError(`Invalid development secret name ${JSON.stringify(name)}.`);
  }
  const fs = loadBuiltin<NodeFs>("node:fs");
  const path = loadBuiltin<NodePath>("node:path");
  if (!fs || !path) return getEphemeralSecret(name);

  const configRoot = (globalThis as typeof globalThis & { [FARM_CONFIG_ROOT]?: string })[
    FARM_CONFIG_ROOT
  ];
  const root = path.resolve(options.root ?? configRoot ?? process.cwd());
  const file = path.join(root, ".farm", `${name}-secret`);
  if (process.env.NODE_ENV === "test") return getEphemeralSecret(file);

  const existing = readSecretFile(fs, file);
  if (existing) return existing;

  const generated = createSecret();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // `wx` keeps a secret another process wrote first; that one is read back below.
    fs.writeFileSync(file, `${generated}\n`, { flag: "wx", mode: 0o600 });
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return getEphemeralSecret(file);
  }

  // Another process won the race, or the file holds no usable secret.
  const raced = readSecretFile(fs, file);
  if (raced) return raced;
  try {
    fs.writeFileSync(file, `${generated}\n`, { mode: 0o600 });
    return generated;
  } catch {
    return getEphemeralSecret(file);
  }
}

function loadBuiltin<T>(id: string): T | undefined {
  try {
    return globalThis.process?.getBuiltinModule?.(id) as T | undefined;
  } catch {
    return undefined;
  }
}

function readSecretFile(fs: NodeFs, file: string): string | undefined {
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    return value.length >= 32 ? value : undefined;
  } catch {
    return undefined;
  }
}

function createSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getEphemeralSecret(key: string): string {
  let secret = ephemeralSecrets.get(key);
  if (!secret) {
    secret = createSecret();
    ephemeralSecrets.set(key, secret);
  }
  return secret;
}
