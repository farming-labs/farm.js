# Response pathname diagnostic

Run `node benchmarks/response-pathname/run.mjs` from the repository root with Node 24.11+.
No build or dependency install is needed. This executes the current generated response-preparation
and preload helpers with the real preload manager/reporter. The in-memory baseline restores eager
pathname parsing and warning-context construction. No framework source or published score changes.

Seven scenarios cover JSON, buffered/unknown HTML, configured headers, HTML/header preload warnings,
and headers plus warnings. Five alternating fresh-process pairs each warm up 500 responses, then
measure five batches of 2,000. Response construction, preparation and full-body reads are timed;
all bodies and headers are checked outside timing. URL-construction counts are a separate check.
Exact header matching, basePath normalization and a CSP-disabled identity adapter isolate this
mechanism; real CSP, plugin request replacement, base paths, cookies and streams are covered by tests.

These are microseconds per response-helper pipeline, not SSR or HTTP p50/p95. Source/runner hashes,
host load and raw pairs are retained. Generated helper byte counts are not complete app bundle size.
Review the active-header/warning controls as well as the fast paths. The maintained framework
benchmark configures cache headers and therefore still needs a URL parse: do not remove those
headers or change the workload to claim a ranking improvement.
