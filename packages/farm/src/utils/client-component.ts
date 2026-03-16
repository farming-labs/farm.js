import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function readIfExists(filePath: string): string | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function resolveModuleSourcePath(modulePath: string, root?: string): string | null {
  const candidates = new Set<string>();

  if (modulePath) {
    candidates.add(modulePath);

    if (modulePath.startsWith("file://")) {
      try {
        candidates.add(fileURLToPath(modulePath));
      } catch {
        // ignore invalid file urls
      }
    }

    if (modulePath.startsWith("/@fs/")) {
      candidates.add(modulePath.slice(4));
    }
  }

  if (root && modulePath) {
    const normalized = modulePath.replace(/^\/+/, "");
    candidates.add(path.join(root, normalized));
    candidates.add(path.resolve(root, normalized));
  }

  if (modulePath?.startsWith("/src/")) {
    const normalized = modulePath.replace(/^\/+/, "");
    candidates.add(path.join(process.cwd(), normalized));
    candidates.add(path.resolve(process.cwd(), normalized));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function isClientComponentModule(modulePath: string, root?: string): boolean {
  const resolvedPath = resolveModuleSourcePath(modulePath, root);
  const content = resolvedPath ? readIfExists(resolvedPath) : null;

  if (!content) {
    return false;
  }

  const normalized = content.trimStart();
  return normalized.startsWith("'use client'") || normalized.startsWith('"use client"');
}
