import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface FarmDocsPublicFontAsset {
  family: "Geist Sans" | "Geist Mono";
  url: string;
}

export interface FarmDocsFontAsset extends FarmDocsPublicFontAsset {
  sourcePath: string;
}

const FARM_DOCS_FONT_SOURCES = [
  {
    family: "Geist Sans",
    packagePath: "geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  },
  {
    family: "Geist Mono",
    packagePath: "geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  },
] as const;

export function resolveFarmDocsFontAssets(root: string): FarmDocsFontAsset[] {
  return FARM_DOCS_FONT_SOURCES.flatMap(({ family, packagePath }) => {
    const sourcePath = path.join(root, "node_modules", packagePath);
    if (!existsSync(sourcePath)) return [];

    const source = readFileSync(sourcePath);
    const fingerprint = createHash("sha256").update(source).digest("hex").slice(0, 12);
    const extension = path.extname(packagePath);
    const baseName = path.basename(packagePath, extension);

    return [
      {
        family,
        sourcePath,
        url: `/assets/${baseName}-h${fingerprint}${extension}`,
      },
    ];
  });
}

export function toFarmDocsPublicFontAssets(
  assets: readonly FarmDocsFontAsset[],
): FarmDocsPublicFontAsset[] {
  return assets.map(({ family, url }) => ({ family, url }));
}
