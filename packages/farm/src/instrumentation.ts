import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleNodeModule } from "./build/node-module-bundle";
import type { FarmInstrumentationModule } from "./instrumentation-runtime";

export * from "./instrumentation-runtime";

const INSTRUMENTATION_EXTENSIONS = ["ts", "mts", "js", "mjs"] as const;

export function resolveFarmInstrumentationFile(root: string, srcDir = "src"): string | null {
  const candidates = [
    ...INSTRUMENTATION_EXTENSIONS.map((extension) =>
      path.join(root, srcDir, `instrumentation.${extension}`),
    ),
    ...INSTRUMENTATION_EXTENSIONS.map((extension) =>
      path.join(root, `instrumentation.${extension}`),
    ),
  ].filter((candidate) => fs.existsSync(candidate));

  if (candidates.length > 1) {
    throw new Error(
      `Farm.js found multiple instrumentation files:\n${candidates
        .map((candidate) => `- ${path.relative(root, candidate)}`)
        .join("\n")}\nKeep only one instrumentation file in the project root or ${srcDir}/.`,
    );
  }

  return candidates[0] ?? null;
}

export async function loadFarmInstrumentation(
  filePath: string | null,
  root: string,
): Promise<FarmInstrumentationModule | null> {
  if (!filePath) return null;

  const outputDirectory = path.join(root, ".farm", ".instrumentation-loader");
  const outputFile = path.join(outputDirectory, "instrumentation.mjs");
  await fs.promises.mkdir(outputDirectory, { recursive: true });
  await bundleNodeModule({
    root,
    entry: filePath,
    outfile: outputFile,
    target: "node20",
    externalPackages: true,
  });

  const url = pathToFileURL(outputFile);
  url.searchParams.set("t", String(Date.now()));
  return (await import(url.href)) as FarmInstrumentationModule;
}
