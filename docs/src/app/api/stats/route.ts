// GitHub stars and the best week of npm downloads for the site header's live counters. The CDN
// keeps the answer for an hour, so visitors never reach GitHub or npm themselves.
const REPOSITORY = "farming-labs/farm.js";
const PACKAGE = "@farm.js/core";
/** The package's first publish: npm has no downloads to report before it. */
const FIRST_PUBLISHED = "2026-07-29";
/** npm's range endpoint answers at most 18 months per request. */
const RANGE_DAYS = 500;
const DAY_MS = 24 * 60 * 60 * 1_000;
const TIMEOUT_MS = 4_000;

export interface SiteStats {
  stars: number | null;
  /** The most downloads in any 7 consecutive days since the first publish. */
  peakWeeklyDownloads: number | null;
}

async function readJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "farmjs.dev", ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

async function readStars(): Promise<number | null> {
  const token = process.env.GITHUB_TOKEN;
  const repository = (await readJson(
    `https://api.github.com/repos/${REPOSITORY}`,
    token ? { authorization: `Bearer ${token}` } : {},
  )) as { stargazers_count?: unknown } | null;
  return isCount(repository?.stargazers_count) ? repository.stargazers_count : null;
}

const day = (time: number) => new Date(time).toISOString().slice(0, 10);

/** The highest 7-day download total, read as daily counts from the first publish to today. */
async function readPeakWeeklyDownloads(now = Date.now()): Promise<number | null> {
  const ranges: string[] = [];
  for (let start = Date.parse(FIRST_PUBLISHED); start <= now; start += RANGE_DAYS * DAY_MS) {
    ranges.push(`${day(start)}:${day(Math.min(start + (RANGE_DAYS - 1) * DAY_MS, now))}`);
  }
  const pages = await Promise.all(
    ranges.map(
      (range) =>
        readJson(`https://api.npmjs.org/downloads/range/${range}/${PACKAGE}`) as Promise<{
          downloads?: { day?: unknown; downloads?: unknown }[];
        } | null>,
    ),
  );
  const daily: number[] = [];
  for (const page of pages) {
    // A missing page would hide a week, so the peak is only reported from complete data.
    if (!Array.isArray(page?.downloads)) return null;
    for (const entry of page.downloads) {
      if (!isCount(entry.downloads)) return null;
      daily.push(entry.downloads);
    }
  }
  if (daily.length === 0) return null;
  let week = 0;
  let peak = 0;
  for (let index = 0; index < daily.length; index++) {
    week += daily[index]!;
    if (index >= 7) week -= daily[index - 7]!;
    peak = Math.max(peak, week);
  }
  return peak;
}

export async function GET(): Promise<Response> {
  const [stars, peakWeeklyDownloads] = await Promise.all([readStars(), readPeakWeeklyDownloads()]);
  const stats: SiteStats = { stars, peakWeeklyDownloads };
  return Response.json(stats, {
    headers: {
      // A partial answer (GitHub or npm down, or rate limited) is retried after five minutes.
      "cache-control":
        stars !== null && peakWeeklyDownloads !== null
          ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
          : "public, max-age=60, s-maxage=300",
      "x-content-type-options": "nosniff",
    },
  });
}
