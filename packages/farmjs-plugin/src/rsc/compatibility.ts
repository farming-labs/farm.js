import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const RSC_PACKAGE_VERSIONS = {
  react: "19.2.8",
  "react-dom": "19.2.8",
  "react-server-dom-webpack": "19.2.8",
  "@vitejs/plugin-rsc": "0.5.32",
} as const;

type RscPackageName = keyof typeof RSC_PACKAGE_VERSIONS;

interface PackageManifest {
  version?: unknown;
}

function readPackageVersion(
  projectRequire: NodeRequire,
  packageName: RscPackageName,
): string | undefined {
  const manifestPath = projectRequire.resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
  return typeof manifest.version === "string" ? manifest.version : undefined;
}

/**
 * React's framework-level RSC APIs do not follow semver. Keep the complete
 * renderer/decoder toolchain on the exact combination exercised by Farm's
 * integration tests instead of accepting a potentially incompatible or
 * vulnerable package resolution.
 */
export function assertRscPackageCompatibility(root: string): void {
  const projectRequire = createRequire(path.join(path.resolve(root), "__farm_rsc_check__.cjs"));
  const problems: string[] = [];

  for (const [packageName, expectedVersion] of Object.entries(RSC_PACKAGE_VERSIONS) as Array<
    [RscPackageName, string]
  >) {
    try {
      const actualVersion = readPackageVersion(projectRequire, packageName);
      if (actualVersion !== expectedVersion) {
        problems.push(
          `${packageName}: expected ${expectedVersion}, found ${actualVersion ?? "unknown"}`,
        );
      }
    } catch {
      problems.push(`${packageName}: expected ${expectedVersion}, package is not installed`);
    }
  }

  if (problems.length === 0) return;

  throw new Error(
    [
      "[Farm.js] Unsupported React Server Components package combination.",
      ...problems.map((problem) => `- ${problem}`),
      "",
      "Farm pins the framework-level RSC APIs to one supported, integration-tested combination.",
      "Install the supported versions with:",
      "pnpm add react@19.2.8 react-dom@19.2.8 react-server-dom-webpack@19.2.8",
      "pnpm add -D @vitejs/plugin-rsc@0.5.32",
    ].join("\n"),
  );
}
