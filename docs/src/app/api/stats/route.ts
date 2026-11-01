// GitHub stars for the site header's live counter. The CDN keeps the answer for an hour, so
// visitors never reach GitHub themselves.
const REPOSITORY = "farming-labs/farm.js";
const TIMEOUT_MS = 4_000;

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

export async function GET(): Promise<Response> {
  const stars = await readStars();
  const stats: SiteStats = { stars };
  return Response.json(stats, {
    headers: {
      // A missing count (GitHub down or rate limited) is retried after five minutes.
      "cache-control":
        stars !== null
          ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
          : "public, max-age=60, s-maxage=300",
      "x-content-type-options": "nosniff",
    },
  });
}
