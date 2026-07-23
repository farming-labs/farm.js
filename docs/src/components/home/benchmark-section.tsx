import { Activity, Rocket, TimerReset } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import nextIconUrl from "simple-icons/icons/nextdotjs.svg?url";
import nuxtIconUrl from "simple-icons/icons/nuxt.svg?url";
import svelteIconUrl from "simple-icons/icons/svelte.svg?url";
import tanstackIconUrl from "simple-icons/icons/tanstack.svg?url";
import {
  benchmarkReport,
  formatBenchmarkDuration,
} from "../../lib/framework-benchmark";

type FrameworkResult = (typeof benchmarkReport.frameworks)[number];
type MetricKey = keyof FrameworkResult["metrics"];

const farmResult = benchmarkReport.frameworks.find(
  (framework) => framework.id === "farm",
);
const competitorResults = benchmarkReport.frameworks.filter(
  (framework) => framework.id !== "farm",
);
const frameworkIconUrls = {
  farm: "/favicon.svg",
  next: nextIconUrl,
  nuxt: nuxtIconUrl,
  sveltekit: svelteIconUrl,
  tanstack: tanstackIconUrl,
} as const satisfies Record<FrameworkResult["id"], string>;

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

const chartInsetX = 42;
const chartTopY = 250;

function formatByteCount(bytes: number) {
  return bytes >= 1024
    ? (bytes / 1024).toFixed(1) + " KB"
    : Math.round(bytes) + " B";
}

function formatMetricValue(key: MetricKey, value: number) {
  return key === "responseBytes"
    ? formatByteCount(value)
    : formatBenchmarkDuration(value);
}

function formatRatio(value: number) {
  return value >= 10 ? value.toFixed(1) + "×" : value.toFixed(2) + "×";
}

function getMetricMinimum(key: MetricKey) {
  return Math.min(
    ...benchmarkReport.frameworks.map(
      (framework) => framework.metrics[key].median,
    ),
  );
}

function getMetricExtent(key: MetricKey) {
  const values = benchmarkReport.frameworks.map(
    (framework) => framework.metrics[key].median,
  );

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

function getAdvantageAgainst(
  framework: FrameworkResult | undefined,
  key: MetricKey,
) {
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

function getChartPoints(
  framework: FrameworkResult,
  width: number,
  height: number,
) {
  const insetX = chartInsetX;
  const insetTop = chartTopY;
  const insetBottom = 96;
  const step = (width - insetX * 2) / Math.max(1, chartMetrics.length - 1);

  return chartMetrics.map(([metric, label], index) => {
    const { maximum, minimum } = getMetricExtent(metric);
    const rawValue = framework.metrics[metric].median;
    const rank =
      maximum === minimum ? 0 : (rawValue - minimum) / (maximum - minimum);
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

  return points.slice(1).reduce(
    (path, point, index) => {
      const previous = points[index];

      return `${path} L ${point.x.toFixed(2)} ${previous.y.toFixed(2)} L ${point.x.toFixed(
        2,
      )} ${point.y.toFixed(2)}`;
    },
    `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`,
  );
}

function closeAreaPath(
  path: string,
  points: readonly ChartPoint[],
  baselineY: number,
) {
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  return firstPoint && lastPoint
    ? `${path} L ${lastPoint.x.toFixed(2)} ${baselineY} L ${firstPoint.x.toFixed(2)} ${baselineY} Z`
    : path;
}

function closeCeilingPath(
  path: string,
  points: readonly ChartPoint[],
  ceilingY: number,
) {
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

function ComparisonPanel({
  description,
  icon: Icon,
  illustration,
  label,
  title,
}: {
  description: string;
  icon: ComponentType<{
    "aria-hidden"?: boolean;
    className?: string;
    strokeWidth?: number;
  }>;
  illustration: ReactNode;
  label: string;
  title: ReactNode;
}) {
  return (
    <article className="flex min-h-[30rem] flex-col bg-black p-6 sm:min-h-[32rem] sm:p-8 lg:p-10">
      <span className="flex items-center gap-2 font-mono text-[10px] font-normal uppercase tracking-normal text-white/46">
        <Icon aria-hidden className="size-4" strokeWidth={1.5} />
        {label}
      </span>
      {illustration}
      <h3 className="mt-4 max-w-xl text-2xl font-medium leading-tight tracking-normal text-white sm:mt-5 sm:text-3xl">
        {title}
      </h3>
      <p className="mt-3 max-w-md text-sm leading-6 text-white/42">
        {description}
      </p>
    </article>
  );
}

function AnimatedComparisonTitle({
  lead,
  metric,
}: {
  lead: string;
  metric: MetricKey;
}) {
  const comparisons = competitorResults.map((framework) => ({
    framework,
    ratio: getAdvantageAgainst(framework, metric),
  }));
  const accessibleComparison = comparisons
    .map(
      ({ framework, ratio }) =>
        `${formatRatio(ratio)} faster than ${framework.label}`,
    )
    .join("; ");

  return (
    <>
      <span className="sr-only">
        {lead}: {accessibleComparison}.
      </span>
      <span aria-hidden className="block">
        {lead}
      </span>
      <span
        aria-hidden
        className="mt-1 grid h-[2.5em] grid-cols-[5ch_auto] items-start gap-x-[0.28em] overflow-hidden text-white/72 sm:flex sm:h-[1.25em] sm:items-baseline"
      >
        <span className="benchmark-comparison-rotator block h-[1.25em] w-[5ch] shrink-0 overflow-hidden">
          {comparisons.map(({ framework, ratio }) => (
            <span
              key={framework.id}
              className="benchmark-comparison-item block"
            >
              {formatRatio(ratio)}
            </span>
          ))}
        </span>
        <span className="whitespace-nowrap">faster than</span>
        <span className="benchmark-comparison-rotator col-span-2 block h-[1.25em] w-full overflow-hidden sm:w-[11rem] sm:flex-none">
          {comparisons.map(({ framework }) => (
            <span
              key={framework.id}
              className="benchmark-comparison-item block"
            >
              {framework.label}.
            </span>
          ))}
        </span>
      </span>
    </>
  );
}

function StartupIllustration() {
  return (
    <div
      aria-hidden
      className="benchmark-illustration relative mt-4 flex h-52 items-center justify-center sm:h-56"
    >
      <svg
        className="h-full w-full max-w-[28rem] text-white"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 520 300"
      >
        <g className="benchmark-startup-stack">
          <path
            d="M106 145L260 227L414 145"
            stroke="currentColor"
            strokeOpacity="0.2"
          />
          <path
            d="M106 145V165L260 247L414 165V145"
            stroke="currentColor"
            strokeOpacity="0.2"
          />
          <path
            d="M106 185L260 267L414 185"
            stroke="currentColor"
            strokeOpacity="0.11"
          />
          <path
            d="M106 185V205L260 287L414 205V185"
            stroke="currentColor"
            strokeOpacity="0.11"
          />
          <path
            d="M106 126V185"
            stroke="currentColor"
            strokeDasharray="2 7"
            strokeOpacity="0.13"
          />
          <path
            d="M414 126V185"
            stroke="currentColor"
            strokeDasharray="2 7"
            strokeOpacity="0.13"
          />
          <path
            d="M260 208V267"
            stroke="currentColor"
            strokeDasharray="2 7"
            strokeOpacity="0.1"
          />
        </g>

        <g className="benchmark-startup-top">
          <path
            d="M106 104L260 22L414 104L260 186L106 104Z"
            fill="currentColor"
            fillOpacity="0.025"
            stroke="currentColor"
            strokeOpacity="0.5"
            strokeWidth="1.2"
          />
          <path
            d="M106 104V126L260 208L414 126V104"
            stroke="currentColor"
            strokeOpacity="0.38"
            strokeWidth="1.2"
          />

          <g className="benchmark-startup-page">
            <path
              d="M176 104L260 59L344 104L260 149L176 104Z"
              fill="currentColor"
              fillOpacity="0.018"
              stroke="currentColor"
              strokeOpacity="0.34"
            />
            <path
              d="M190 104L260 67L330 104"
              stroke="currentColor"
              strokeOpacity="0.24"
            />
            <path
              d="M208 108L260 81L312 108"
              stroke="currentColor"
              strokeOpacity="0.32"
            />
            <path
              d="M222 116L260 96L298 116"
              stroke="currentColor"
              strokeOpacity="0.19"
            />
            <path
              d="M238 124L260 113L282 124"
              stroke="currentColor"
              strokeOpacity="0.11"
            />
            <circle
              cx="260"
              cy="104"
              fill="currentColor"
              fillOpacity="0.66"
              r="2.5"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}

function BuildIllustration() {
  return (
    <div
      aria-hidden
      className="benchmark-illustration relative mt-4 flex h-52 items-center justify-center sm:h-56"
    >
      <svg
        className="h-full w-full max-w-[28rem] text-white"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 520 300"
      >
        <g className="benchmark-build-module benchmark-build-module--back">
          <path
            d="M194 72L260 37L326 72L260 107L194 72Z"
            fill="currentColor"
            fillOpacity="0.018"
            stroke="currentColor"
            strokeOpacity="0.24"
          />
          <path
            d="M194 72V125L260 160L326 125V72"
            stroke="currentColor"
            strokeOpacity="0.17"
          />
        </g>

        <g className="benchmark-build-module benchmark-build-module--left">
          <path
            d="M78 139L149 101L220 139L149 177L78 139Z"
            fill="currentColor"
            fillOpacity="0.022"
            stroke="currentColor"
            strokeOpacity="0.36"
          />
          <path
            d="M78 139V198L149 236L220 198V139"
            stroke="currentColor"
            strokeOpacity="0.25"
          />
          <path
            d="M123 139L149 125L175 139"
            stroke="currentColor"
            strokeOpacity="0.18"
          />
        </g>

        <g className="benchmark-build-module benchmark-build-module--right">
          <path
            d="M300 139L371 101L442 139L371 177L300 139Z"
            fill="currentColor"
            fillOpacity="0.018"
            stroke="currentColor"
            strokeOpacity="0.3"
          />
          <path
            d="M300 139V198L371 236L442 198V139"
            stroke="currentColor"
            strokeOpacity="0.2"
          />
        </g>

        <g className="benchmark-build-output">
          <path
            d="M190 190L260 153L330 190L260 227L190 190Z"
            fill="currentColor"
            fillOpacity="0.035"
            stroke="currentColor"
            strokeOpacity="0.55"
            strokeWidth="1.2"
          />
          <path
            d="M190 190V242L260 279L330 242V190"
            fill="currentColor"
            fillOpacity="0.012"
            stroke="currentColor"
            strokeOpacity="0.42"
            strokeWidth="1.2"
          />
          <path d="M260 227V279" stroke="currentColor" strokeOpacity="0.28" />
          <path
            d="M218 190L260 168L302 190"
            stroke="currentColor"
            strokeOpacity="0.32"
          />
          <path
            d="M231 198L260 183L289 198"
            stroke="currentColor"
            strokeOpacity="0.17"
          />
          <circle
            cx="260"
            cy="190"
            fill="currentColor"
            fillOpacity="0.68"
            r="2.5"
          />
        </g>
      </svg>
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
    <div className="relative col-span-full min-h-[40rem] overflow-hidden border-t border-white/12 bg-black">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 max-w-2xl px-6 pt-6 sm:px-12 sm:pt-12">
        <span className="flex items-center gap-2 font-mono text-[10px] font-normal uppercase tracking-normal text-white/46">
          <span className="text-white/44">01.5</span>
          <span aria-hidden className="text-white/18">
            /
          </span>
          <Activity aria-hidden className="size-4" strokeWidth={1.5} />
          Benchmark
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
        <span className="mt-1 block">Y: raw median / lower is better</span>
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
            <linearGradient
              id="tanstackBenchmarkFill"
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            >
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.045" />
              <stop offset="55%" stopColor="currentColor" stopOpacity="0.014" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <filter id="benchmarkIconInvert">
              <feComponentTransfer>
                <feFuncR tableValues="1 0" type="table" />
                <feFuncG tableValues="1 0" type="table" />
                <feFuncB tableValues="1 0" type="table" />
              </feComponentTransfer>
            </filter>
          </defs>
          <rect
            fill="url(#benchmarkRangeFill)"
            height={baselineY - chartTopY}
            pointerEvents="none"
            width={width - chartInsetX * 2}
            x={chartInsetX}
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
            const x =
              chartInsetX +
              (index * (width - chartInsetX * 2)) /
                Math.max(1, chartMetrics.length - 1);
            const { maximum, minimum } = getMetricExtent(metric);
            const textAnchor =
              index === 0
                ? "start"
                : index === chartMetrics.length - 1
                  ? "end"
                  : "middle";

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
              d={closeCeilingPath(
                farmSeries.path,
                farmSeries.points,
                chartTopY,
              )}
              fill="url(#farmBenchmarkFill)"
              pointerEvents="none"
            />
          ) : null}
          {foregroundSeries.map(({ framework, path }) => {
            const title = chartMetrics
              .map(
                ([key, label]) =>
                  `${label}: ${formatMetricValue(key, framework.metrics[key].median)}`,
              )
              .join(" · ");
            const isFarm = framework.id === "farm";

            return (
              <g key={framework.id} className="benchmark-series group">
                <path
                  className="benchmark-series-line"
                  d={path}
                  fill="none"
                  stroke="white"
                  strokeDasharray={
                    !isFarm && framework.id !== "tanstack" ? "8 8" : undefined
                  }
                  strokeOpacity={seriesOpacity[framework.id]}
                  strokeWidth={
                    isFarm
                      ? "1.45"
                      : framework.id === "tanstack"
                        ? "1.2"
                        : "0.8"
                  }
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
                const iconUrl = frameworkIconUrls[framework.id];

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
                      r={
                        isFarm
                          ? "3.3"
                          : framework.id === "tanstack"
                            ? "2.6"
                            : "2.1"
                      }
                      stroke="white"
                      strokeOpacity={
                        isFarm ? "0.88" : seriesOpacity[framework.id]
                      }
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
                        height="62"
                        stroke="white"
                        strokeOpacity={isFarm ? "0.16" : "0.12"}
                        width="226"
                        x={tooltipX}
                        y={tooltipY}
                      />
                      <image
                        filter={
                          isFarm ? undefined : "url(#benchmarkIconInvert)"
                        }
                        height="12"
                        href={iconUrl}
                        opacity={isFarm ? "0.9" : "0.82"}
                        width="12"
                        x={tooltipX + 10}
                        y={tooltipY + 10.5}
                      />
                      <text
                        dominantBaseline="middle"
                        fill="currentColor"
                        fontFamily="var(--font-geist-mono, monospace)"
                        fontSize="8.5"
                        x={tooltipX + 29}
                        y={tooltipY + 17}
                      >
                        {framework.label.toUpperCase()}
                      </text>
                      <text
                        fill="currentColor"
                        fillOpacity={isFarm ? "0.68" : "0.62"}
                        fontFamily="var(--font-geist-mono, monospace)"
                        fontSize="9"
                        x={tooltipX + 10}
                        y={tooltipY + 39}
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
                        y={tooltipY + 53}
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
        const ratio = rival
          ? rival.metrics[key].median / farmValue
          : getMetricMinimum(key) / farmValue;

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
  return (
    <section
      aria-labelledby="framework-benchmark-title"
      className="farm-full-rule w-full"
      id="benchmarks"
    >
      <h2 className="sr-only" id="framework-benchmark-title">
        Framework benchmarks
      </h2>

      <div className="grid bg-black lg:grid-cols-2">
        <ComparisonPanel
          description="Cold dev startup through the first rendered SSR page, measured against the same routed fixture."
          icon={Rocket}
          illustration={<StartupIllustration />}
          label="Startup advantage"
          title={
            <AnimatedComparisonTitle
              lead="Farm opens the benchmark app"
              metric="devFirstPageMs"
            />
          }
        />
        <div className="border-t border-white/12 lg:border-l lg:border-t-0">
          <ComparisonPanel
            description="A complete production compile of the same SSR project, with generated output ready to boot."
            icon={TimerReset}
            illustration={<BuildIllustration />}
            label="Production build"
            title={
              <AnimatedComparisonTitle
                lead="Farm builds the same fixture"
                metric="buildMs"
              />
            }
          />
        </div>

        <BenchmarkAreaChart />
      </div>

      <MetricStrip />
    </section>
  );
}
