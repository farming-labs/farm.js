import { readFileSync, writeFileSync } from "node:fs";

/**
 * Whether a generated file on disk already holds `content`. Generation always
 * emits LF, but a Windows checkout with `core.autocrlf=true` (the Git for
 * Windows default) stores committed files with CRLF, so line endings are not
 * part of the comparison.
 */
export function isGeneratedFileCurrent(current: string, content: string): boolean {
  return current === content || normalizeLineEndings(current) === normalizeLineEndings(content);
}

function normalizeLineEndings(source: string): string {
  return source.includes("\r") ? source.replace(/\r\n/g, "\n") : source;
}

export function writeFileIfChanged(filePath: string, content: string): boolean {
  try {
    if (isGeneratedFileCurrent(readFileSync(filePath, "utf8"), content)) {
      return false;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  writeFileSync(filePath, content, "utf8");
  return true;
}
