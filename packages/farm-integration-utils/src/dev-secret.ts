import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Set by Farm while it evaluates an app's farm.config, which can live outside the cwd. */
const FARM_CONFIG_ROOT = Symbol.for("farm.configRoot");

/** Secrets for a process that cannot keep one on disk, by file path. */
const ephemeralSecrets = new Map<string, string>();

/**
 * A random development secret for an integration that signs or seals cookies, in place of a
 * constant fallback that anyone reaching a dev server (a `farm preview` URL, `--host`) could use
 * to forge sessions.
 *
 * Development generates 32 random bytes once per app in `<root>/.farm/<name>-secret`, which is
 * gitignored and denied to the dev file server, and reuses it so sessions survive restarts. Tests
 * and a directory that cannot be written get a random secret for the life of the process.
 * Call it only after deciding the environment is development: production still needs a real one.
 */
export function resolveDevelopmentSecret(name: string, options: { root?: string } = {}): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new TypeError(`Invalid development secret name ${JSON.stringify(name)}.`);
  }
  const configRoot = (globalThis as typeof globalThis & { [FARM_CONFIG_ROOT]?: string })[
    FARM_CONFIG_ROOT
  ];
  const root = path.resolve(options.root ?? configRoot ?? process.cwd());
  const file = path.join(root, ".farm", `${name}-secret`);
  if (process.env.NODE_ENV === "test") return getEphemeralSecret(file);

  const existing = readSecretFile(file);
  if (existing) return existing;

  const generated = randomBytes(32).toString("hex");
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    // `wx` keeps a secret another process wrote first; that one is read back below.
    writeFileSync(file, `${generated}\n`, { flag: "wx", mode: 0o600 });
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return getEphemeralSecret(file);
  }

  // Another process won the race, or the file holds no usable secret.
  const raced = readSecretFile(file);
  if (raced) return raced;
  try {
    writeFileSync(file, `${generated}\n`, { mode: 0o600 });
    return generated;
  } catch {
    return getEphemeralSecret(file);
  }
}

function readSecretFile(file: string): string | undefined {
  try {
    const value = readFileSync(file, "utf8").trim();
    return value.length >= 32 ? value : undefined;
  } catch {
    return undefined;
  }
}

function getEphemeralSecret(key: string): string {
  let secret = ephemeralSecrets.get(key);
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    ephemeralSecrets.set(key, secret);
  }
  return secret;
}
