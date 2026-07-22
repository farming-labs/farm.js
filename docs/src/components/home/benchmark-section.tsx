import { Activity, ExternalLink, Gauge, Rocket, TimerReset } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { benchmarkReport, formatBenchmarkDuration } from "../../lib/framework-benchmark";

const benchmarkLinks = {
  methodology: "https://github.com/Kinfe123/farm.js/blob/main/benchmarks/frameworks/README.md",
  results: "https://github.com/Kinfe123/farm.js/blob/main/benchmarks/frameworks/results/latest.json",
} as const;

type FrameworkResult = (typeof benchmarkReport.frameworks)[number];
type MetricKey = keyof FrameworkResult["metrics"];
type ReportProvenance = {
  inputs?: { readonly sha256: string };
  methodology: { readonly burnInRounds?: number };
  revision: { readonly workspaceDirty?: boolean };
};

const reportProvenance = benchmarkReport as typeof benchmarkReport & ReportProvenance;
const farmResult = benchmarkReport.frameworks.find((framework) => framework.id === "farm");
const competitorResults = benchmarkReport.frameworks.filter((framework) => framework.id !== "farm");
const tanstackResult = benchmarkReport.frameworks.find((framework) => framework.id === "tanstack");
const nextResult = benchmarkReport.frameworks.find((framework) => framework.id === "next");

const leadMetrics = [
  ["devFirstPageMs", "Dev start"],
  ["devWarmResponseMs", "Warm dev"],
  ["buildMs", "Build"],
  ["productionBootMs", "Prod boot"],
  ["productionResponseMs", "SSR p50"],
  ["responseBytes", "HTML"],
] as const satisfies readonly (readonly [MetricKey, string])[];

const chartMetrics = [
  ["devFirstPageMs", "Dev start"],
  ["devWarmResponseMs", "Warm dev"],
  ["buildMs", "Build"],
  ["productionBootMs", "Prod boot"],
  ["productionResponseMs", "SSR"],
] as const satisfies readonly (readonly [MetricKey, string])[];

function formatRunDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}

function formatByteCount(bytes: number) {
  return bytes >= 1024 ? (bytes / 1024).toFixed(1) + " KB" : Math.round(bytes) + " B";
}

function formatMetricValue(key: MetricKey, value: number) {
  return key === "responseBytes" ? formatByteCount(value) : formatBenchmarkDuration(value);
}

function formatRatio(value: number) {
  return value >= 10 ? value.toFixed(1) + "×" : value.toFixed(2) + "×";
}

function getMetricMinimum(key: MetricKey) {
  return Math.min(...benchmarkReport.frameworks.map((framework) => framework.metrics[key].median));
}

function getBestCompetitor(key: MetricKey) {
  return competitorResults.reduce((best, framework) =>
    framework.metrics[key].median < best.metrics[key].median ? framework : best,
  );
}

function getAdvantageAgainst(framework: FrameworkResult | undefined, key: MetricKey) {
  if (!farmResult || !framework) {
    return 0;
  }

  return framework.metrics[key].median / farmResult.metrics[key].median;
}

type ChartPoint = {
  label: string;
  metric: MetricKey;
  value: number;
  x: number;
  y: number;
};

function getChartPoints(framework: FrameworkResult, width: number, height: number) {
  const insetX = 42;
  const insetTop = 205;
  const insetBottom = 96;
  const step = (width - insetX * 2) / Math.max(1, chartMetrics.length - 1);

  return chartMetrics.map(([metric, label], index) => {
    const best = getMetricMinimum(metric);
    const value = (best / framework.metrics[metric].median) * 100;
    const x = insetX + index * step;
    const clamped = Math.max(0, Math.min(100, value));
    const y = insetTop + (100 - clamped) * ((height - insetTop - insetBottom) / 100);

    return { label, metric, value, x, y };
  });
}

function buildStepBeforePath(points: readonly ChartPoint[]) {
  if (!points.length) {
    return "";
  }

  return points
    .slice(1)
    .reduce(
      (path, point, index) => {
        const previous = points[index];

        return `${path} L ${point.x.toFixed(2)} ${previous.y.toFixed(2)} L ${point.x.toFixed(
          2,
        )} ${point.y.toFixed(2)}`;
      },
      `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`,
    );
}

function closeAreaPath(path: string, points: readonly ChartPoint[], baselineY: number) {
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  return firstPoint && lastPoint
    ? `${path} L ${lastPoint.x.toFixed(2)} ${baselineY} L ${firstPoint.x.toFixed(2)} ${baselineY} Z`
    : path;
}

function BenchmarkIndexLabel() {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] font-normal uppercase tracking-normal text-current">
      <span className="text-white/44">01.5</span>
      <span aria-hidden className="text-white/18">
        /
      </span>
      <Gauge aria-hidden className="size-3.5" strokeWidth={1.5} />
      <span>Benchmarks</span>
    </span>
  );
}

function BenchmarkLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      className="group inline-flex min-h-9 items-center gap-1.5 border border-white/12 px-3 font-mono text-[9px] font-normal uppercase tracking-normal text-white/52 transition-[background-color,border-color,color] duration-150 hover:border-white/24 hover:bg-white/[0.045] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      href={href}
    >
      {children}
      <ExternalLink
        aria-hidden
        className="size-3 text-white/30 transition-colors group-hover:text-white/72"
        strokeWidth={1.5}
      />
    </a>
  );
}

function ComparisonPanel({
  children,
  icon: Icon,
  label,
  title,
}: {
  children: ReactNode;
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string; strokeWidth?: number }>;
  label: string;
  title: string;
}) {
  return (
    <article className="min-h-[20rem] bg-black p-6 sm:p-8 lg:p-10">
      <span className="flex items-center gap-2 font-mono text-[10px] font-normal uppercase tracking-normal text-white/46">
        <Icon aria-hidden className="size-4" strokeWidth={1.5} />
        {label}
      </span>
      <p className="mt-7 max-w-md text-2xl font-medium leading-tight tracking-normal text-white sm:text-3xl">
        {title}
      </p>
      {children}
    </article>
  );
}

function MiniComparisonTable({ metric }: { metric: MetricKey }) {
  if (!farmResult) {
    return null;
  }

  return (
    <div className="mt-8 space-y-3">
      {[farmResult, ...competitorResults].map((framework) => {
        const isFarm = framework.id === "farm";
        const value = framework.metrics[metric].median;
        const maximum = Math.max(
          ...benchmarkReport.frameworks.map((item) => item.metrics[metric].median),
        );
        const width = Math.max(7, (value / maximum) * 100);

        return (
          <div
            key={framework.id}
            className="grid grid-cols-[7.25rem_minmax(0,1fr)_4.75rem] items-center gap-3"
          >
            <span
              className={
                "truncate font-mono text-[9px] font-normal uppercase tracking-normal " +
                (isFarm ? "text-white" : "text-white/44")
              }
            >
              {framework.label}
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <span
                className={
                  "block h-full rounded-full " + (isFarm ? "bg-white" : "bg-white/22")
                }
                style={{ width: width + "%" }}
              />
            </span>
            <span
              className={
                "text-right font-mono text-[9px] tabular-nums " +
                (isFarm ? "text-white" : "text-white/42")
              }
            >
              {formatMetricValue(metric, value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LeadBand() {
  if (!farmResult) {
    return null;
  }

  const wins = leadMetrics.filter(([key]) => farmResult.metrics[key].median === getMetricMinimum(key));

  return (
    <div className="col-span-full border-y border-white/12 px-6 py-10 sm:px-12 sm:py-14">
      <p className="text-center text-5xl font-semibold leading-none tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl">
        {wins.length}/{leadMetrics.length} Benchmark Leads
      </p>
      <p className="mx-auto mt-5 max-w-2xl text-center text-sm leading-6 text-white/48 sm:text-base sm:leading-7">
        The uptime block becomes benchmark proof: Farm leads most measured production and dev
        latency signals, with every raw sample linked.
      </p>
    </div>
  );
}

function BenchmarkAreaChart() {
  if (!farmResult) {
    return null;
  }

  const width = 960;
  const height = 500;
  const baselineY = height - 72;
  const series = benchmarkReport.frameworks.map((framework) => {
    const points = getChartPoints(framework, width, height);

    return {
      framework,
      path: buildStepBeforePath(points),
      points,
    };
  });
  const farmSeries = series.find((item) => item.framework.id === "farm");
  const seriesOpacity = {
    farm: "0.95",
    next: "0.24",
    sveltekit: "0.36",
    nuxt: "0.2",
    tanstack: "0.58",
  } as const;

  return (
    <div className="relative col-span-full min-h-[40rem] overflow-hidden bg-black">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 max-w-2xl px-6 pt-6 sm:px-12 sm:pt-12">
        <span className="flex items-center gap-2 font-mono text-[10px] font-normal uppercase tracking-normal text-white/46">
          <Activity aria-hidden className="size-4" strokeWidth={1.5} />
          Benchmark monitor
        </span>

        <p className="my-6 text-2xl font-medium leading-tight tracking-normal text-white sm:text-3xl">
          Monitor framework latency across startup, build, boot, and SSR.{" "}
          <span className="text-white/42">
            Higher bands mean closer to the fastest median for that benchmark.
          </span>
        </p>
      </div>

      <div className="pointer-events-none absolute right-6 top-6 z-10 hidden border border-white/12 bg-black/70 px-3 py-2 font-mono text-[9px] uppercase tracking-normal text-white/44 backdrop-blur sm:block">
        <span className="block text-white/68">X: benchmark set</span>
        <span className="mt-1 block">Y: speed index / fastest = 100</span>
      </div>

      <div className="relative h-[40rem]">
        <svg
          aria-label="Farm.js benchmark comparison area chart"
          className="absolute inset-x-0 bottom-0 h-full w-full text-white"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <linearGradient id="farmBenchmarkFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.36" />
              <stop offset="55%" stopColor="currentColor" stopOpacity="0.1" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="tanstackBenchmarkFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
              <stop offset="55%" stopColor="currentColor" stopOpacity="0.05" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[205, 261, 317, 373, 429].map((y) => (
            <line
              key={y}
              stroke="currentColor"
              strokeOpacity="0.08"
              strokeWidth="1"
              x1="0"
              x2={width}
              y1={y}
              y2={y}
            />
          ))}
          {[100, 75, 50, 25, 0].map((label, index) => (
            <text
              key={label}
              fill="currentColor"
              fillOpacity="0.35"
              fontFamily="var(--font-geist-mono, monospace)"
              fontSize="9"
              x="18"
              y={209 + index * 56}
            >
              {label}
            </text>
          ))}
          {chartMetrics.map(([, label], index) => {
            const x = 42 + (index * (width - 84)) / Math.max(1, chartMetrics.length - 1);

            return (
              <g key={label}>
                <text
                  fill="currentColor"
                  fillOpacity="0.48"
                  fontFamily="var(--font-geist-mono, monospace)"
                  fontSize="10"
                  textAnchor={index === 0 ? "start" : index === chartMetrics.length - 1 ? "end" : "middle"}
                  x={x}
                  y={height - 30}
                >
                  {label}
                </text>
              </g>
            );
          })}
          {series
            .filter((item) => item.framework.id === "tanstack")
            .map(({ framework, path, points }) => (
              <path
                key={framework.id}
                d={closeAreaPath(path, points, baselineY)}
                fill="url(#tanstackBenchmarkFill)"
              />
            ))}
          {farmSeries ? (
            <path
              d={closeAreaPath(farmSeries.path, farmSeries.points, baselineY)}
              fill="url(#farmBenchmarkFill)"
            />
          ) : null}
          {series
            .filter((item) => item.framework.id !== "farm")
            .map(({ framework, path, points }) => {
              const lastPoint = points[points.length - 1];
              const title = chartMetrics
                .map(([key, label]) => `${label}: ${formatMetricValue(key, framework.metrics[key].median)}`)
                .join(" · ");

              return (
                <g key={framework.id} className="group">
                  <path
                    d={path}
                    fill="none"
                    stroke="white"
                    strokeDasharray={framework.id === "tanstack" ? "0" : "8 8"}
                    strokeOpacity={seriesOpacity[framework.id]}
                    strokeWidth={framework.id === "tanstack" ? "2.4" : "1.5"}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    aria-label={`${framework.label} — ${title}`}
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="18"
                    vectorEffect="non-scaling-stroke"
                  />
                  {points.map((point) => (
                    <circle
                      key={point.metric}
                      cx={point.x}
                      cy={point.y}
                      fill="black"
                      r={framework.id === "tanstack" ? "3" : "2.4"}
                      stroke="white"
                      strokeOpacity={seriesOpacity[framework.id]}
                      strokeWidth="1"
                    />
                  ))}
                  {lastPoint ? (
                    <g className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      <rect
                        fill="black"
                        fillOpacity="0.88"
                        height="22"
                        stroke="white"
                        strokeOpacity="0.18"
                        width={framework.label.length * 7 + 22}
                        x={Math.max(48, Math.min(width - 180, lastPoint.x - 98))}
                        y={Math.max(208, lastPoint.y - 32)}
                      />
                      <text
                        fill="currentColor"
                        fontFamily="var(--font-geist-mono, monospace)"
                        fontSize="10"
                        x={Math.max(59, Math.min(width - 169, lastPoint.x - 87))}
                        y={Math.max(223, lastPoint.y - 17)}
                      >
                        {framework.label}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          {farmSeries ? (
            <g className="group">
              <path
                d={farmSeries.path}
                fill="none"
                stroke="white"
                strokeOpacity="0.98"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
              <path
                aria-label={`Farm.js — ${chartMetrics
                  .map(([key, label]) => `${label}: ${formatMetricValue(key, farmResult.metrics[key].median)}`)
                  .join(" · ")}`}
                d={farmSeries.path}
                fill="none"
                stroke="transparent"
                strokeWidth="20"
                vectorEffect="non-scaling-stroke"
              />
              {farmSeries.points.map((point) => (
                <circle
                  key={point.metric}
                  cx={point.x}
                  cy={point.y}
                  fill="black"
                  r="4"
                  stroke="white"
                  strokeOpacity="0.95"
                  strokeWidth="1.5"
                  aria-label={`Farm.js · ${point.label}: ${formatMetricValue(
                    point.metric,
                    farmResult.metrics[point.metric].median,
                  )}`}
                />
              ))}
              <text
                className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                fill="currentColor"
                fontFamily="var(--font-geist-mono, monospace)"
                fontSize="11"
                textAnchor="end"
                x={width - 54}
                y={Math.max(217, farmSeries.points[farmSeries.points.length - 1]?.y ?? 217) - 14}
              >
                Farm.js
              </text>
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
}

function MetricStrip() {
  if (!farmResult) {
    return null;
  }

  return (
    <div className="farm-top-rule grid gap-px bg-white/12 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {leadMetrics.map(([key, label]) => {
        const farmValue = farmResult.metrics[key].median;
        const isLead = farmValue === getMetricMinimum(key);
        const rival = isLead ? getBestCompetitor(key) : undefined;
        const ratio = rival ? rival.metrics[key].median / farmValue : getMetricMinimum(key) / farmValue;

        return (
          <div key={key} className="bg-black px-5 py-4">
            <p className="font-mono text-[8px] font-normal uppercase tracking-normal text-white/42">
              {label}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-mono text-sm font-medium tabular-nums tracking-normal text-white">
                {formatMetricValue(key, farmValue)}
              </span>
              <span
                className={
                  "font-mono text-[8px] font-normal uppercase tracking-normal " +
                  (isLead ? "text-white/56" : "text-white/34")
                }
              >
                {isLead ? formatRatio(ratio) + " edge" : "near lead"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BenchmarkSection() {
  const firstDevPage = farmResult
    ? formatBenchmarkDuration(farmResult.metrics.devFirstPageMs.median)
    : "—";
  const buildAdvantage = getAdvantageAgainst(tanstackResult, "buildMs");
  const devAdvantage = getAdvantageAgainst(tanstackResult, "devFirstPageMs");
  const bootAdvantage = getAdvantageAgainst(nextResult, "productionBootMs");
  const runDate = formatRunDate(benchmarkReport.generatedAt);
  const burnInRounds = reportProvenance.methodology.burnInRounds ?? 0;
  const inputHash = reportProvenance.inputs?.sha256.slice(0, 12);
  const revisionSuffix = benchmarkReport.revision.farmSourceDirty ? " + source changes" : "";
  const workspaceSuffix = reportProvenance.revision.workspaceDirty
    ? " · broader workspace dirty"
    : "";

  return (
    <section
      aria-labelledby="framework-benchmark-title"
      className="farm-full-rule w-full"
      id="benchmarks"
    >
      <div className="grid w-full lg:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="flex items-start border-b border-white/12 p-6 text-white/52 sm:px-6 sm:py-8 lg:border-b-0 lg:border-r">
          <BenchmarkIndexLabel />
        </div>

        <div className="px-6 py-10 sm:px-10 sm:py-12 lg:px-12">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="max-w-3xl">
              <p className="font-mono text-[10px] font-normal uppercase tracking-normal text-white/52">
                Benchmark proof
              </p>
              <h2
                className="mt-4 text-balance text-3xl font-medium leading-[1.06] tracking-normal text-white sm:text-4xl"
                id="framework-benchmark-title"
              >
                Farm reaches the first rendered dev page in {firstDevPage}
              </h2>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-white/48 sm:text-base sm:leading-7">
                The benchmark is a real project built with each framework, not a framework package
                compile. It runs the same dynamic SSR fixture across Farm.js, Next.js, SvelteKit,
                Nuxt, and TanStack Start.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <BenchmarkLink href={benchmarkLinks.methodology}>Methodology</BenchmarkLink>
              <BenchmarkLink href={benchmarkLinks.results}>Raw samples</BenchmarkLink>
            </div>
          </div>
        </div>
      </div>

      <div className="farm-top-rule grid bg-black lg:grid-cols-2">
        <ComparisonPanel
          icon={Rocket}
          label="Startup advantage"
          title={`Farm opens the benchmark app ${formatRatio(devAdvantage)} faster than TanStack Start.`}
        >
          <MiniComparisonTable metric="devFirstPageMs" />
        </ComparisonPanel>
        <div className="border-t border-white/12 lg:border-l lg:border-t-0">
          <ComparisonPanel
            icon={TimerReset}
            label="Production build"
            title={`Farm builds the same fixture ${formatRatio(buildAdvantage)} faster than TanStack Start.`}
          >
            <div className="mt-8 grid grid-cols-2 gap-px bg-white/12">
              <div className="bg-black p-4">
                <p className="font-mono text-[8px] uppercase tracking-normal text-white/42">
                  Farm build
                </p>
                <p className="mt-1 font-mono text-lg font-medium tabular-nums text-white">
                  {farmResult ? formatMetricValue("buildMs", farmResult.metrics.buildMs.median) : "—"}
                </p>
              </div>
              <div className="bg-black p-4">
                <p className="font-mono text-[8px] uppercase tracking-normal text-white/42">
                  Boot vs Next.js
                </p>
                <p className="mt-1 font-mono text-lg font-medium tabular-nums text-white">
                  {formatRatio(bootAdvantage)}
                </p>
              </div>
            </div>
            <MiniComparisonTable metric="buildMs" />
          </ComparisonPanel>
        </div>

        <LeadBand />
        <BenchmarkAreaChart />
      </div>

      <MetricStrip />

      <div className="farm-top-rule grid gap-px bg-white/12 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            "Rounds",
            String(benchmarkReport.methodology.runs) +
              " measured" +
              (burnInRounds ? " + " + burnInRounds + " burn-in" : ""),
          ],
          ["Machine", benchmarkReport.system.cpu + " / " + benchmarkReport.system.memoryGb + " GB"],
          ["Runtime", "Node " + benchmarkReport.system.node],
          ["Measured", runDate],
        ].map(([label, value]) => (
          <div key={label} className="bg-black px-5 py-4">
            <span className="block font-mono text-[8px] font-normal uppercase tracking-normal text-white/48">
              {label}
            </span>
            <span className="mt-1 block font-mono text-[10px] font-normal uppercase tracking-normal text-white/62">
              {value}
            </span>
          </div>
        ))}
      </div>

      <div className="farm-top-rule flex flex-col gap-3 px-5 py-4 font-mono text-[9px] font-normal uppercase leading-4 tracking-normal text-white/52 lg:flex-row lg:items-start lg:justify-between">
        <p className="max-w-4xl">
          Synthetic local-loopback baseline, not a universal ranking. It excludes browser render,
          hydration, HMR, network, hosted availability, and real production-app behavior. Generated
          framework caches were cleared while the OS cache stayed warm
          {burnInRounds ? "; the burn-in round was discarded" : ""}.
        </p>
        <p className="shrink-0 text-white/48 lg:text-right">
          <span className="block">
            Farm {benchmarkReport.revision.commit}
            {revisionSuffix}
            {workspaceSuffix}
          </span>
          {inputHash ? <span className="block">Input SHA {inputHash}</span> : null}
        </p>
      </div>
    </section>
  );
}
