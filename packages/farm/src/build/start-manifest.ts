import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedFarmDeployConfig } from "../config";

type StartOutput = Pick<ResolvedFarmDeployConfig, "target" | "preset" | "outputDir">;

const manifestPath = (root: string) => path.join(root, ".farm", "start.json");

export async function writeFarmStartManifest(root: string, deploy: StartOutput): Promise<void> {
  const file = manifestPath(root);
  const temp = file + "." + randomUUID();
  const { target, preset, outputDir } = deploy;
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(temp, JSON.stringify({ version: 1, target, preset, outputDir }));
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function readFarmStartManifest(root: string): Promise<StartOutput | undefined> {
  const file = manifestPath(root);
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const data = JSON.parse(source);
    if (
      data?.version === 1 &&
      typeof data.preset === "string" &&
      data.preset &&
      typeof data.outputDir === "string" &&
      data.outputDir &&
      (data.target === undefined ||
        ["node", "cloudflare", "netlify", "vercel"].includes(data.target))
    )
      return data;
  } catch (cause) {
    throw Object.assign(new Error(`Could not read ${file}. Run \`farm build\` again.`), { cause });
  }
  throw new Error(`Invalid start manifest at ${file}. Run \`farm build\` again.`);
}

export async function loadFarmStartEnvironment(root: string): Promise<void> {
  if (
    ![".env", ".env.local", ".env.production", ".env.production.local"].some((file) =>
      existsSync(path.join(root, file)),
    )
  )
    return;
  const { loadEnv } = await import("vite");
  for (const [key, value] of Object.entries(loadEnv("production", root, ""))) {
    process.env[key] ??= value;
  }
}
