import { existsSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RSC_FIXTURE_PACKAGES = [
  "react",
  "react-dom",
  "react-server-dom-webpack",
  "@vitejs/plugin-rsc",
] as const;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export function linkRscFixtureDependencies(root: string): void {
  for (const packageName of RSC_FIXTURE_PACKAGES) {
    const source = [
      path.join(repositoryRoot, "node_modules", packageName),
      path.join(repositoryRoot, "examples/rsc-demo/node_modules", packageName),
    ].find((candidate) => existsSync(candidate));
    if (!source) throw new Error(`Missing RSC fixture dependency: ${packageName}`);

    const target = path.join(root, "node_modules", packageName);
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(realpathSync(source), target, process.platform === "win32" ? "junction" : "dir");
  }
}
