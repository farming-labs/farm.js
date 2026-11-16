#!/usr/bin/env node
import process from "node:process";
import { generateStrapiTypes } from "./schema.js";

const usage = `Usage: farm-strapi generate [options]

Options:
  --strapi-root <directory>  Strapi project root (default: current directory)
  --output <file>            Generated declaration (default: src/strapi.generated.d.ts)
  --check                    Fail when the declaration is stale or missing
  --help                     Show this help`;

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  args.splice(index, 2);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (args.shift() !== "generate") throw new Error(usage);

  let strapiRoot = process.cwd();
  let output = "src/strapi.generated.d.ts";
  let check = false;
  for (let index = 0; index < args.length; ) {
    const option = args[index];
    if (option === "--strapi-root") {
      strapiRoot = takeValue(args, index, option);
    } else if (option === "--output") {
      output = takeValue(args, index, option);
    } else if (option === "--check") {
      check = true;
      args.splice(index, 1);
    } else {
      throw new Error(`Unknown option: ${option}\n\n${usage}`);
    }
  }

  const result = await generateStrapiTypes({ strapiRoot, outFile: output, check });
  process.stdout.write(
    `${check ? "Verified" : result.changed ? "Generated" : "Unchanged"} ${result.outFile} (${result.contentTypes} content types, ${result.components} components)\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
