// One sample in a fresh process (see README.md): the cold cost of the production client's route
// matchers, as `setFarmClientRoutes` builds them on its first navigation, then warm medians.
// Usage: node measure.mjs <router bundle> <routes>
import { performance } from "node:perf_hooks";
import { clientRouteTable, MISS_PATH, PROBE_PATHS } from "./routes.mjs";

const [bundle, countArg] = process.argv.slice(2);
const table = clientRouteTable(Number(countArg));
const { createFarmRouter } = await import(bundle);

const toRoute = (route) => ({ path: route.pattern, meta: route });
// What the generated client runtime does with the table: every route, and (with docs routes)
// the app pages, whose directory a docs route's layouts take.
function buildClientMatchers() {
  const routes = createFarmRouter(table.map(toRoute));
  const pages = createFarmRouter(table.filter((route) => !route.docs).map(toRoute));
  return { routes, pages };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// Cold: the first construction and the first match in this process, a dynamic path that scans
// past every route the exact-path map does not hold.
let start = performance.now();
const cold = buildClientMatchers();
const coldBuildMs = performance.now() - start;
start = performance.now();
const coldMatch = cold.routes.match(MISS_PATH);
const coldFirstMatchMs = performance.now() - start;
if (coldMatch?.route.path !== "/docs/[[...slug]]") {
  throw new Error(`Unexpected match for ${MISS_PATH}: ${coldMatch?.route.path}`);
}

// Warm: medians over many constructions and matches after the JIT has settled.
const builds = [];
for (let index = 0; index < 60; index++) {
  start = performance.now();
  buildClientMatchers();
  builds.push(performance.now() - start);
}
const matches = [];
for (let round = 0; round < 200; round++) {
  start = performance.now();
  for (const pathname of PROBE_PATHS) cold.routes.match(pathname);
  matches.push((performance.now() - start) / PROBE_PATHS.length);
}

console.log(
  JSON.stringify({
    coldBuildMs,
    coldFirstMatchMs,
    warmBuildMs: median(builds.slice(20)),
    warmMatchMs: median(matches.slice(50)),
  }),
);
