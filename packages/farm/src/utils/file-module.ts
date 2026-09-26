import { pathToFileURL } from "node:url";

export function toFileModuleUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}
