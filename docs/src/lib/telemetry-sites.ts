import type { Prisma } from "@prisma/client";

/** Vercel-confirmed preview aliases recorded before runtime environment filtering was added. */
export const FARM_LEGACY_VERCEL_PREVIEW_SITE_URLS = [
  "https://docs-git-fix-ci-duplicate-runtime-import-kinfe123s-projects.vercel.app",
  "https://docs-git-fix-explain-programmatic-manifests-kinfe123s-projects.vercel.app",
  "https://docs-git-fix-query-array-round-trip-kinfe123s-projects.vercel.app",
  "https://docs-git-fix-router-skip-document-prefetch-kinfe123s-projects.vercel.app",
  "https://docs-git-fix-server-query-force-refetch-kinfe123s-projects.vercel.app",
  "https://docs-git-perf-react-queued-rolling-windows-kinfe123s-projects.vercel.app",
] as const;

const legacyVercelPreviewSites = new Set<string>(FARM_LEGACY_VERCEL_PREVIEW_SITE_URLS);

export const farmLegacyVercelPreviewSiteWhere: Prisma.FarmProductionSiteWhereInput = {
  url: { in: [...FARM_LEGACY_VERCEL_PREVIEW_SITE_URLS] },
};

export const farmProductionSiteWhere: Prisma.FarmProductionSiteWhereInput = {
  NOT: farmLegacyVercelPreviewSiteWhere,
};

export function isFarmLegacyVercelPreviewSite(siteUrl: string): boolean {
  return legacyVercelPreviewSites.has(siteUrl);
}
