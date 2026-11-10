#!/usr/bin/env bash
# Runs the official js-framework-benchmark CPU, memory and size suites for the Farm adapters and
# the harness's own entries, then writes the Farm-vs-React summary and the cross-framework
# comparison. Used by the "js-framework-benchmark" CI job; it also runs locally.
#
#   scripts/run-official.sh <js-framework-benchmark checkout> <output directory>
#
# Environment:
#   CHROME_BINARY                  Chrome or Chromium executable (default: google-chrome, chromium)
#   FARM_BENCHMARK_FRAMEWORKS      harness entries to compare besides the Farm adapters
#                                  (default below; must include react-hooks)
#   FARM_BENCHMARK_CPU_SAMPLES     CPU samples per operation (default 10)
#   FARM_BENCHMARK_MEMORY_SAMPLES  memory samples per benchmark (default 3)
#
# The harness's packages run with npm lifecycle scripts disabled. Build @farm.js/react first.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <js-framework-benchmark checkout> <output directory>" >&2
  exit 2
fi
benchmark_root=$(cd "$1" && pwd)
mkdir -p "$2"
output_dir=$(cd "$2" && pwd)
example_root=$(cd "$(dirname "$0")/.." && pwd)

chrome=${CHROME_BINARY:-$(command -v google-chrome || command -v chromium || true)}
if [ -z "$chrome" ] || [ ! -x "$chrome" ]; then
  echo "Set CHROME_BINARY to a Chrome or Chromium executable." >&2
  exit 2
fi
export FARM_BENCHMARK_CPU_SAMPLES=${FARM_BENCHMARK_CPU_SAMPLES:-10}
export FARM_BENCHMARK_MEMORY_SAMPLES=${FARM_BENCHMARK_MEMORY_SAMPLES:-3}
read -r -a others <<<"${FARM_BENCHMARK_FRAMEWORKS:-vanillajs solid svelte vue preact-hooks react-hooks react-compiler-hooks}"
if [[ " ${others[*]} " != *" react-hooks "* ]]; then
  echo "FARM_BENCHMARK_FRAMEWORKS must include react-hooks, the Farm summary's baseline." >&2
  exit 2
fi
frameworks=()
for name in "${others[@]}" farm-react-off farm-react-static farm-react-hybrid; do
  frameworks+=("keyed/$name")
done

results_dir="$benchmark_root/webdriver-ts/results"
if [ -d "$results_dir" ] && [ -n "$(ls -A "$results_dir")" ]; then
  echo "$results_dir is not empty. Move earlier results aside so runs are not mixed." >&2
  exit 1
fi

echo "::group::Install the harness"
(cd "$benchmark_root/server" && npm ci --ignore-scripts --no-audit --no-fund)
(cd "$benchmark_root/webdriver-ts" && npm ci --ignore-scripts --no-audit --no-fund && npm run compile)
echo "::endgroup::"

echo "::group::Build the harness's framework entries"
for name in "${others[@]}"; do
  entry="$benchmark_root/frameworks/keyed/$name"
  if [ ! -f "$entry/package.json" ]; then
    echo "No harness entry at frameworks/keyed/$name." >&2
    exit 1
  fi
  (
    cd "$entry"
    npm ci --ignore-scripts --no-audit --no-fund
    if node -e 'process.exit(require("./package.json").scripts?.["build-prod"] ? 0 : 1)'; then
      npm run build-prod
    fi
  )
done
echo "::endgroup::"

echo "::group::Build the Farm adapters"
(cd "$example_root" && pnpm prepare:official "$benchmark_root")
echo "::endgroup::"

(cd "$benchmark_root/server" && exec ./node_modules/.bin/tsx index.ts) >"$output_dir/server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null http://localhost:8080/index.html; then break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$output_dir/server.log" >&2
    exit 1
  fi
  sleep 1
done
curl -sf -o /dev/null http://localhost:8080/index.html

cd "$benchmark_root/webdriver-ts"
export LANG=en_US.UTF-8
echo "::group::Keyed-identity check"
node dist/isKeyed.js --headless --chromeBinary "$chrome" --framework "${frameworks[@]}"
echo "::endgroup::"
echo "::group::CPU suite"
node dist/benchmarkRunner.js --headless --runner playwright --count "$FARM_BENCHMARK_CPU_SAMPLES" \
  --chromeBinary "$chrome" --framework "${frameworks[@]}" \
  --benchmark 01_ 02_ 03_ 04_ 05_ 06_ 07_ 08_ 09_
echo "::endgroup::"
echo "::group::Memory suite"
node dist/benchmarkRunner.js --headless --runner playwright --count "$FARM_BENCHMARK_MEMORY_SAMPLES" \
  --chromeBinary "$chrome" --framework "${frameworks[@]}" --benchmark 21_ 22_ 25_
echo "::endgroup::"
# The size suite launches Chrome through Puppeteer without --no-sandbox, which Chrome refuses as
# root and which some CI kernels block for unprivileged users. Only this suite gets the flag.
no_sandbox="$output_dir/chrome-no-sandbox"
printf '#!/bin/sh\nexec "%s" --no-sandbox "$@"\n' "$chrome" >"$no_sandbox"
chmod +x "$no_sandbox"
echo "::group::Size suite"
node dist/benchmarkRunner.js --headless --runner playwright --count "$FARM_BENCHMARK_MEMORY_SAMPLES" \
  --chromeBinary "$no_sandbox" --framework "${frameworks[@]}" --benchmark 40_
echo "::endgroup::"

cp -R "$results_dir" "$output_dir/results"
cd "$example_root"
FARM_BENCHMARK_OUTPUT="$output_dir/farm-vs-react.json" pnpm summarize:official "$benchmark_root"
FARM_COMPARISON_OUTPUT="$output_dir/framework-comparison.json" pnpm compare:frameworks "$benchmark_root"
{
  echo "harness revision: $(git -C "$benchmark_root" rev-parse HEAD)"
  echo "browser: $("$chrome" --version)"
  echo "node: $(node --version)"
  echo "os: $(uname -srm)"
  echo "cpu: $(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ //')"
  echo "cpu samples: $FARM_BENCHMARK_CPU_SAMPLES, memory samples: $FARM_BENCHMARK_MEMORY_SAMPLES"
} >"$output_dir/environment.txt"
cat "$output_dir/environment.txt"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  node -e '
    const { tables } = require(process.argv[1]);
    const env = require("node:fs").readFileSync(process.argv[2], "utf8").trim().split("\n");
    const order = tables.cpu.map((row) => row.framework);
    const score = (name, framework) => tables[name].find((row) => row.framework === framework).score.toFixed(3);
    const lines = [
      "## js-framework-benchmark",
      "",
      "Scores relative to the best framework in this run (1.000 = best on every benchmark).",
      "",
      "| Framework | CPU | Memory | Size |",
      "| --- | --: | --: | --: |",
      ...order.map((f) => `| ${f} | ${score("cpu", f)} | ${score("memory", f)} | ${score("size", f)} |`),
      "",
      ...env.map((line) => `- ${line}`),
    ];
    require("node:fs").appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  ' "$output_dir/framework-comparison.json" "$output_dir/environment.txt"
fi
