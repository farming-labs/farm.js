# Preview tunnel benchmark

Compares the direct local target, the TypeScript persistent preview agent, and the Rust N-API persistent preview agent over the same WebSocket relay and protocol.

## Prerequisites

Build the independent Rust package first:

```bash
cd ../tunnel
npm install
npm run build
```

Then run the benchmark from the Farm.js repository:

```bash
pnpm benchmark:preview
```

Override the Rust package path when it is not a sibling of `farm.js`:

```bash
FARM_PREVIEW_RUST_PACKAGE=/absolute/path/to/tunnel pnpm benchmark:preview
```

The benchmark validates POST bodies, query strings, response status and headers, and automatic route invalidation before recording latency and throughput. Both agents use the same relay, target server, 4 KiB payload, warmup, and concurrency settings.

Environment variables can override the workload:

- `FARM_PREVIEW_BENCH_WARMUP`
- `FARM_PREVIEW_BENCH_SEQUENTIAL`
- `FARM_PREVIEW_BENCH_CONCURRENT`
- `FARM_PREVIEW_BENCH_CONCURRENCY`
- `FARM_PREVIEW_BENCH_PAYLOAD`

See [results-2026-08-05.md](./results-2026-08-05.md) for the first verified comparison.
