# Client route candidate lookup

Run `pnpm --filter @farm.js/core exec vitest bench src/__benchmarks__/client-route-candidates.bench.ts --run`.

The control is `ClientRouteManifest` from f920c090. Each lookup workload resolves a static
route and binds one dynamic parameter in a manifest with 1, 1,000 or 10,000 unrelated dynamic
routes plus the static route. Controls assert identical results. Construction is measured
separately at 1,000 dynamic routes; indexes add startup work and memory.

Recorded on macOS arm64, Node 24.21.0, pnpm 8.12.1, while other workspace builds/tests were
running. These timing samples were extremely noisy and **must not be used as speedup claims**:

| Workload                      | Previous mean | Indexed mean | RME      |
| ----------------------------- | ------------- | ------------ | -------- |
| 1,000 routes, resolve + bind  | 2.9964 ms     | 0.1672 ms    | 44–61%   |
| 10,000 routes, resolve + bind | 70.8379 ms    | 0.2110 ms    | 53–60%   |
| 1,000 routes, construction    | 4.9612 ms     | 44.4229 ms   | 120–127% |

The deterministic test is the reliable evidence: static resolution and binding no longer
enumerate any of the unrelated route table's values/keys. Dynamic URL shadow detection still
uses the existing full matcher; this is not an indexed replacement for that algorithm.

Indexes belong only to the internal, client-owned manifest snapshot. Public API input remains
copied, including method arrays. No public mutable API matcher changes. Startup retains candidate
references and per-prefix segment Sets. The minified browser client-route module measured
4,211 → 4,540 bytes; gzip 1,828 → 1,958 bytes.
