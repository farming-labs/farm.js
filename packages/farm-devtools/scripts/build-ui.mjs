import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";

await mkdir(new URL("../dist/ui/", import.meta.url), { recursive: true });
await build({
  entryPoints: ["src/panel.ts"],
  outfile: "dist/ui/panel.js",
  bundle: true,
  minify: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  loader: { ".woff2": "file", ".woff": "file" },
  assetNames: "[name]-[hash]",
  publicPath: "/__farm/devtools/assets/",
});
await copyFile("src/logo.svg", "dist/ui/logo.svg");
await copyFile("node_modules/@fontsource-variable/geist/LICENSE", "dist/ui/LICENSE-geist.txt");
await copyFile(
  "node_modules/@fontsource-variable/geist-mono/LICENSE",
  "dist/ui/LICENSE-geist-mono.txt",
);
