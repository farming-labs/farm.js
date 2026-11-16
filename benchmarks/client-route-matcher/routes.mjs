// A production client route table shaped like a docs-heavy app (see README.md): 60% docs pages,
// 15% content pages under a route group, and 25% app routes with params, catch-alls, optional
// catch-alls and groups, plus the docs catch-all.
export function clientRouteTable(count) {
  const table = [
    { pattern: "/", pageShouldHydrate: true, islandStrategy: "load", loader: 0 },
    { pattern: "/docs/[[...slug]]", pageShouldHydrate: false, docs: true, islandStrategy: "load" },
  ];
  for (let index = 0; table.length < count; index++) {
    const bucket = index % 20;
    const entry = { pageShouldHydrate: bucket >= 12, islandStrategy: "load" };
    if (bucket < 12) {
      Object.assign(entry, { pattern: `/docs/section-${index % 17}/page-${index}`, docs: true });
    } else if (bucket < 15) {
      entry.pattern = `/guides/page-${index}`;
      entry.directory = `/(content)/guides/page-${index}`;
    } else if (bucket === 15) {
      entry.pattern = `/(app)/area-${index}/[id]`;
    } else if (bucket === 16) {
      entry.pattern = `/(app)/area-${index}/[id]/settings`;
    } else if (bucket === 17) {
      entry.pattern = `/(shop)/shop-${index}/[[...filters]]`;
    } else if (bucket === 18) {
      entry.pattern = `/files-${index}/[...path]`;
    } else {
      entry.pattern = `/(marketing)/teams/team-${index}/[team]/projects/[project]`;
    }
    if (entry.pageShouldHydrate) entry.loader = table.length;
    table.push(entry);
  }
  return table;
}

/** A path no exact route holds, which falls through every route to the docs catch-all. */
export const MISS_PATH = "/docs/missing/page";

/** Paths for the correctness control and warm matching: hits of every kind, misses, escapes. */
export const PROBE_PATHS = [
  "/",
  "/docs",
  "/docs/section-3/page-3",
  "/docs/section-3/page-%33",
  MISS_PATH,
  "/guides/page-12",
  "/guides/page-12/",
  "/area-15/abc",
  "/area-15/a%2Fb",
  "/area-16/abc/settings",
  "/shop-17",
  "/shop-17/red/large",
  "/files-18/a/b/c",
  "/files-18",
  "/teams/team-19/acme/projects/web",
  "/teams/team-19/acme/projects",
  "/missing/route",
  "/%ZZ",
  "//guides//page-12?x=1#y",
];
