import { readFileSync, writeFileSync } from "node:fs";

export function writeFileIfChanged(filePath: string, content: string): boolean {
  try {
    if (readFileSync(filePath, "utf8") === content) {
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
