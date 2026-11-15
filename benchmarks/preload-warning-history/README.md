# Preload warning history diagnostic

Run `node benchmarks/preload-warning-history/run.mjs` with Node 24.11+ from the repository root.
No build or dependency installation is needed. This loads current `preload.ts`, strips types,
and restores the old unconditional history sweep only in the baseline's in-memory source.
It does not change the framework, benchmark fixtures, or published benchmark scores.

Five alternating fresh-process pairs cover empty history, 256 live records with no warnings,
duplicate warnings, new warnings, and expired history. A separate expired-history control collects
setup garbage before timing, without removing the fresh-allocation control. Select one case with
`FARM_WARNING_SCENARIO=expiredCollectedHistory` when investigating setup/GC effects.
Each process uses five batches of 100,000
calls after 20,000 warmups; the expired-history control uses 1,000 calls after 100 warmups and
pre-seeds all 256 entries in separate instances outside timing. Logs are counted rather than printed. A fake clock isolates
the reporter mechanism; 5,000 differential steps first compare real log strings and private
history through expiry, clock rollback, reset, and eviction.

Output includes raw samples, source/runner hashes, environment, and medians of process means in
microseconds per helper call. Source byte counts are not deployment bundle sizes. This is not an
HTTP latency benchmark or evidence of an equivalent framework-wide speedup. Check active-warning
controls as well as the empty path; do not select only favorable runs.

The runtime now skips sweeps until the earliest possible expiry. Empty calls still purge expired
entries, the history remains limited to 256 entries, and clock rollback retains existing warning
behavior. Evicting the earliest entry may cause an unnecessary future sweep but cannot delay one.
