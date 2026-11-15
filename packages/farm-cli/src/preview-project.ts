import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

/** Account-scoped project identity, independent of URL names and API keys. */
export async function resolvePreviewProject(options: { root?: string; project?: string }) {
  const explicit = options.project ?? process.env.FARM_PREVIEW_PROJECT;
  if (explicit !== undefined) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(explicit))
      throw new Error(
        "Preview project must be a lowercase slug of 1–63 letters, numbers or hyphens.",
      );
    return explicit;
  }
  const root = resolve(options.root ?? process.cwd());
  let name = basename(root);
  try {
    const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    if (typeof manifest.name === "string" && manifest.name.trim()) name = manifest.name;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Cannot read the app package.json. Fix it or pass --project explicitly.");
  }
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63) || "app"
  );
}
