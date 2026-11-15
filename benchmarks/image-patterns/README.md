# Image policy pattern benchmark

Run `pnpm --filter @farm.js/core exec vitest bench src/__benchmarks__/image-pattern.bench.ts --run`.

Compare cached pathname pattern matching with the exact previous glob implementation from
`image-server.ts` at `4c7b1017`. Both scan the same 25 configured patterns and match the final
pattern. Correctness controls run before timing. The cache keys are policy objects, not request
URLs; edits to a pattern's pathname invalidate its compiled expression.

This measures warmed policy-matching CPU work only, not image transformation, source network
latency, or complete optimizer throughput. Protocol, hostname, port, search, redirect, and private
address validation remain live and unchanged.
