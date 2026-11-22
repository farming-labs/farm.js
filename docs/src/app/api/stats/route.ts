import { getStorage } from "@farm.js/core/storage";

// GitHub stars for the site header's live counter. The CDN keeps the answer for an hour, so
// visitors never reach GitHub themselves. The last count GitHub gave is kept in the `stats`
// storage mount on Farm.js Infra, so a GitHub outage or rate limit shows that count instead of
// no count.
const REPOSITORY = "farming-labs/farm.js";
const TIMEOUT_MS = 4_000;
/** The `stats` mount key holding the last count GitHub returned. */
export const STARS_KEY = "github:stars";

interface StoredStars {
  stars: number;
  readAt: string;
}

export interface SiteStats {
  stars: number | null;
}

async function readStars(): Promise<number | null> {
  const token = process.env.GITHUB_TOKEN;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}`, {
      headers: {
        accept: "application/json",
        "user-agent": "farmjs.dev",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const { stargazers_count: stars } = (await response.json()) as { stargazers_count?: unknown };
    return Number.isSafeInteger(stars) && (stars as number) >= 0 ? (stars as number) : null;
  } catch {
    return null;
  }
}

function isStoredStars(value: unknown): value is StoredStars {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isSafeInteger((value as StoredStars).stars) &&
    (value as StoredStars).stars >= 0
  );
}

/** Remembers a fresh count, or returns the remembered one when GitHub gave none. */
async function withLastKnown(fresh: number | null): Promise<number | null> {
  const store = getStorage("stats");
  try {
    if (fresh !== null) {
      await store.setItem<StoredStars>(STARS_KEY, {
        stars: fresh,
        readAt: new Date().toISOString(),
      });
      return fresh;
    }
    const stored = await store.getItem(STARS_KEY);
    return isStoredStars(stored) ? stored.stars : null;
  } catch (error) {
    // The header can go without a count; it can't go without the endpoint.
    console.error("[farmjs.stats] Farm.js Infra storage failed:", error);
    return fresh;
  }
}

export async function GET(): Promise<Response> {
  const fresh = await readStars();
  const stars = await withLastKnown(fresh);
  const stats: SiteStats = { stars };
  return Response.json(stats, {
    headers: {
      // A count GitHub didn't just give (down or rate limited) is retried after five minutes.
      "cache-control":
        fresh !== null
          ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
          : "public, max-age=60, s-maxage=300",
      "x-content-type-options": "nosniff",
    },
  });
}
