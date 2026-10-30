// Live GitHub stars and npm weekly downloads for the site header. The numbers come from
// /api/stats (cached at the CDN) after hydration, so the server HTML and the first client
// render match, and a count that isn't available is simply left out.
import { useEffect, useState } from "react";
import type { SiteStats } from "../app/api/stats/route";

export type { SiteStats };

let request: Promise<SiteStats | null> | undefined;

/** 681 stays 681; 5531 is 5.5k; 22404 is 22k; 1250000 is 1.3M. */
export function formatCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** One request per page load, shared by every header that asks. */
export function loadSiteStats(): Promise<SiteStats | null> {
  request ??= fetch("/api/stats", { headers: { accept: "application/json" } })
    .then((response) => (response.ok ? (response.json() as Promise<SiteStats>) : null))
    .catch(() => null);
  return request;
}

export function useSiteStats(): SiteStats | null {
  const [stats, setStats] = useState<SiteStats | null>(null);
  useEffect(() => {
    let active = true;
    void loadSiteStats().then((value) => {
      if (active) setStats(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return stats;
}

/** Lets tests start from a fresh request. */
export function resetSiteStatsForTests(): void {
  request = undefined;
}
