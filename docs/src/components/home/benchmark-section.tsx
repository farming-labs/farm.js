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
  ["responseBytes", "HTML"],
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

function getMetricExtent(key: MetricKey) {
  const values = benchmarkReport.frameworks.map((framework) => framework.metrics[key].median);

  return {
    maximum: Math.max(...values),
    minimum: Math.min(...values),
  };
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
  rawValue: number;
  x: number;
  y: number;
};

function getChartPoints(framework: FrameworkResult, width: number, height: number) {
  const insetX = 42;
  const insetTop = 250;
  const insetBottom = 96;
  const step = (width - insetX * 2) / Math.max(1, chartMetrics.length - 1);

  return chartMetrics.map(([metric, label], index) => {
    const { maximum, minimum } = getMetricExtent(metric);
    const rawValue = framework.metrics[metric].median;
    const rank = maximum === minimum ? 0 : (rawValue - minimum) / (maximum - minimum);
    const x = insetX + index * step;
    const clamped = Math.max(0, Math.min(1, rank));
    const y = insetTop + (1 - clamped) * (height - insetTop - insetBottom);

    return { label, metric, rawValue, x, y };
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

function closeCeilingPath(path: string, points: readonly ChartPoint[], ceilingY: number) {
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  return firstPoint && lastPoint
    ? `${path} L ${lastPoint.x.toFixed(2)} ${ceilingY} L ${firstPoint.x.toFixed(2)} ${ceilingY} Z`
    : path;
}

function getTooltipX(x: number, width: number) {
  return Math.max(52, Math.min(width - 238, x - 76));
}

function getTooltipY(y: number) {
  return Math.max(252, y - 68);
}

function getColumnRangeLabel(key: MetricKey) {
  const { maximum, minimum } = getMetricExtent(key);

  return `${formatMetricValue(key, minimum)} → ${formatMetricValue(key, maximum)}`;
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
  const chartTopY = 250;
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
  const foregroundSeries = [...series].sort((a, b) => {
    if (a.framework.id === "farm") {
      return 1;
    }

    if (b.framework.id === "farm") {
      return -1;
    }

    return 0;
  });

  return (
    <div className="relative col-span-full min-h-[40rem] overflow-hidden bg-black">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 max-w-2xl px-6 pt-6 sm:px-12 sm:pt-12">
        <span className="flex items-center gap-2 font-mono text-[10px] font-normal uppercase tracking-normal text-white/46">
          <Activity aria-hidden className="size-4" strokeWidth={1.5} />
          Benchmark monitor
        </span>

        <p className="my-6 text-2xl font-medium leading-tight tracking-normal text-white sm:text-3xl">
          Farm.js leads the benchmark app across latency and output size.{" "}
          <span className="text-white/42">
            Raw medians for startup, build, boot, SSR, and HTML.
          </span>
        </p>

        <div className="pointer-events-none flex max-w-2xl flex-wrap gap-2">
          {benchmarkReport.frameworks.map((framework) => (
            <span
              key={framework.id}
              className={
                "inline-flex items-center gap-2 bg-black/45 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-normal backdrop-blur transition-colors duration-200 hover:bg-white/[0.045] hover:text-white " +
                (framework.id === "farm" ? "text-white" : "text-white/48")
              }
            >
              <span
                className={
                  "h-0.5 w-5 " +
                  (framework.id === "farm" || framework.id === "tanstack"
                    ? "bg-current"
                    : "border-t border-dashed border-current")
                }
              />
              {framework.label}
            </span>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute right-6 top-6 z-10 hidden border border-white/12 bg-black/70 px-3 py-2 font-mono text-[9px] uppercase tracking-normal text-white/44 backdrop-blur sm:block">
        <span className="block text-white/68">X: benchmark set</span>
        <span className="mt-1 block">Y: measured median / lower is better</span>
      </div>

      <div className="relative h-[40rem]">
        <svg
          aria-label="Farm.js benchmark comparison area chart"
          className="absolute inset-x-0 bottom-0 h-full w-full text-white"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <style>
            {`
              .benchmark-series-line,
              .benchmark-point-ring,
              .benchmark-point-tooltip {
                transition-duration: 260ms;
                transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
              }

              .benchmark-series-line {
                transition-property: stroke-opacity, stroke-width, filter;
              }

              .benchmark-series:hover .benchmark-series-line,
              .benchmark-series:focus-within .benchmark-series-line {
                filter: drop-shadow(0 0 3px rgba(255, 255, 255, 0.18));
                stroke-opacity: 0.96;
                stroke-width: 1.95;
              }

              .benchmark-point-ring {
                transition-property: opacity, transform, fill-opacity, stroke-opacity;
                transform-box: fill-box;
                transform-origin: center;
              }

              .benchmark-point:hover .benchmark-point-ring,
              .benchmark-point:focus .benchmark-point-ring {
                fill-opacity: 1;
                opacity: 1;
                stroke-opacity: 1;
                transform: scale(1.22);
              }

              .benchmark-point-tooltip {
                filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.42));
                opacity: 0;
                pointer-events: none;
                transform: translateY(8px);
                transition-property: opacity, transform;
              }

              .benchmark-point:hover .benchmark-point-tooltip,
              .benchmark-point:focus .benchmark-point-tooltip {
                opacity: 1;
                transform: translateY(0);
              }

              @media (prefers-reduced-motion: reduce) {
                .benchmark-series-line,
                .benchmark-point-ring,
                .benchmark-point-tooltip {
                  transition-duration: 1ms;
                }
              }
            `}
          </style>
          <defs>
            <linearGradient id="farmBenchmarkFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.095" />
              <stop offset="58%" stopColor="currentColor" stopOpacity="0.034" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="benchmarkRangeFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.05" />
              <stop offset="48%" stopColor="currentColor" stopOpacity="0.016" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="tanstackBenchmarkFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.045" />
              <stop offset="55%" stopColor="currentColor" stopOpacity="0.014" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect
            fill="url(#benchmarkRangeFill)"
            height={baselineY - chartTopY}
            pointerEvents="none"
            width={width - 84}
            x="42"
            y={chartTopY}
          />
          {[250, 295, 339, 384, 428].map((y) => (
            <line
              key={y}
              stroke="currentColor"
              strokeOpacity="0.045"
              strokeWidth="1"
              x1="0"
              x2={width}
              y1={y}
              y2={y}
            />
          ))}
          {chartMetrics.map(([metric, label], index) => {
            const x = 42 + (index * (width - 84)) / Math.max(1, chartMetrics.length - 1);
            const { maximum, minimum } = getMetricExtent(metric);
            const textAnchor = index === 0 ? "start" : index === chartMetrics.length - 1 ? "end" : "middle";

            return (
              <g key={label}>
                <text
                  fill="currentColor"
                  fillOpacity="0.34"
                  fontFamily="var(--font-geist-mono, monospace)"
                  fontSize="8"
                  textAnchor={textAnchor}
                  x={x}
                  y={chartTopY + 6}
                >
                  {formatMetricValue(metric, maximum)}
                </text>
                <text
                  fill="currentColor"
                  fillOpacity="0.42"
                  fontFamily="var(--font-geist-mono, monospace)"
                  fontSize="8"
                  textAnchor={textAnchor}
                  x={x}
                  y={baselineY + 2}
                >
                  {formatMetricValue(metric, minimum)}
                </text>
                <text
                  fill="currentColor"
                  fillOpacity="0.48"
                  fontFamily="var(--font-geist-mono, monospace)"
                  fontSize="10"
                  textAnchor={textAnchor}
                  x={x}
                  y={height - 48}
                >
                  {label.toUpperCase()}
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
                pointerEvents="none"
              />
            ))}
          {farmSeries ? (
            <path
              d={closeCeilingPath(farmSeries.path, farmSeries.points, chartTopY)}
              fill="url(#farmBenchmarkFill)"
              pointerEvents="none"
            />
          ) : null}
          {foregroundSeries.map(({ framework, path }) => {
            const title = chartMetrics
              .map(([key, label]) => `${label}: ${formatMetricValue(key, framework.metrics[key].median)}`)
              .join(" · ");
            const isFarm = framework.id === "farm";

            return (
              <g key={framework.id} className="benchmark-series group">
              <path
                className="benchmark-series-line"
                d={path}
                fill="none"
                stroke="white"
                strokeDasharray={!isFarm && framework.id !== "tanstack" ? "8 8" : undefined}
                strokeOpacity={seriesOpacity[framework.id]}
                strokeWidth={isFarm ? "1.45" : framework.id === "tanstack" ? "1.2" : "0.8"}
                vectorEffect="non-scaling-stroke"
              />
              <path
                aria-label={`${framework.label} — ${title}`}
                d={path}
                fill="none"
                pointerEvents="stroke"
                stroke="transparent"
                strokeWidth={isFarm ? "22" : "20"}
                vectorEffect="non-scaling-stroke"
              />
            </g>
            );
          })}
          {foregroundSeries.map(({ framework, points }) => (
            <g key={`${framework.id}-points`}>
              {points.map((point) => {
                const tooltipX = getTooltipX(point.x, width);
                const tooltipY = getTooltipY(point.y);
                const isFarm = framework.id === "farm";

                return (
                  <g
                    key={point.metric}
                    aria-label={`${framework.label} · ${point.label}: ${formatMetricValue(
                      point.metric,
                      point.rawValue,
                    )} · Column range ${getColumnRangeLabel(point.metric)}`}
                    className="benchmark-point"
                    role="img"
                    tabIndex={0}
                  >
                    <circle
                      className="benchmark-point-ring"
                      cx={point.x}
                      cy={point.y}
                      fill="black"
                      fillOpacity={isFarm ? "0.82" : "0.74"}
                      r={isFarm ? "3.3" : framework.id === "tanstack" ? "2.6" : "2.1"}
                      stroke="white"
                      strokeOpacity={isFarm ? "0.88" : seriesOpacity[framework.id]}
                      strokeWidth={isFarm ? "1.2" : "1"}
                    />
                    <circle
                      cx={point.x}
                      cy={point.y}
                      fill="white"
                      fillOpacity="0.001"
                      pointerEvents="all"
                      r={isFarm ? "14" : "13"}
                    />
                    <g className="benchmark-point-tooltip">
                      <rect
                        fill="black"
                        fillOpacity={isFarm ? "0.96" : "0.94"}
                        height="52"
                        stroke="white"
                        strokeOpacity={isFarm ? "0.16" : "0.12"}
                        width="226"
                        x={tooltipX}
                        y={tooltipY}
                      />
                      <text
                        fill="currentColor"
                        fontFamily="var(--font-geist-mono, monospace)"
                        fontSize="10"
                        x={tooltipX + 10}
                        y={tooltipY + 16}
                      >
                        {framework.label}
                      </text>
                      <text
                        fill="currentColor"
                        fillOpacity={isFarm ? "0.68" : "0.62"}
                        fontFamily="var(--font-geist-mono, monospace)"
                        fontSize="9"
                        x={tooltipX + 10}
                        y={tooltipY + 32}
                      >
                        {point.label.toUpperCase()} MEDIAN ·{" "}
                        {formatMetricValue(point.metric, point.rawValue)}
                      </text>
                      <text
                        fill="currentColor"
                        fillOpacity={isFarm ? "0.52" : "0.48"}
                        fontFamily="var(--font-geist-mono, monospace)"
                        fontSize="8"
                        x={tooltipX + 10}
                        y={tooltipY + 45}
                      >
                        RANGE {getColumnRangeLabel(point.metric)}
                      </text>
                    </g>
                  </g>
                );
              })}
            </g>
          ))}
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
