import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mode = process.env.NODE_ENV === "production" ? "production" : "development";
const loadedEnv = loadEnv(mode, exampleRoot, "");

export const envPaths = {
  exampleRoot,
  envLocal: path.join(exampleRoot, ".env.local"),
} as const;

export function getExampleEnv(key: string, fallback?: string) {
  return process.env[key] ?? loadedEnv[key] ?? fallback;
}

export function requireExampleEnv(key: string, hint: string) {
  const value = getExampleEnv(key);
  if (!value) {
    throw new Error(`${hint} Checked ${envPaths.envLocal}.`);
  }
  return value;
}
