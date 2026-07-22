import { Activity, ExternalLink, Gauge, Rocket, TimerReset } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import nextIconUrl from "simple-icons/icons/nextdotjs.svg?url";
import nuxtIconUrl from "simple-icons/icons/nuxt.svg?url";
import svelteIconUrl from "simple-icons/icons/svelte.svg?url";
import tanstackIconUrl from "simple-icons/icons/tanstack.svg?url";
import farmingLabsLogoUrl from "../../assets/farming-labs-logo-dark.svg?url";
import { benchmarkReport, formatBenchmarkDuration } from "../../lib/framework-benchmark";

const benchmarkLinks = {
  methodology: "https://github.com/Kinfe123/farm.js/blob/main/benchmarks/frameworks/README.md",
  results: "https://github.com/Kinfe123/farm.js/blob/main/benchmarks/frameworks/results/latest.json",
} as const;

const frameworkIcons = {
  farm: farmingLabsLogoUrl,
  next: nextIconUrl,
  sveltekit: svelteIconUrl,
  nuxt: nuxtIconUrl,
  tanstack: tanstackIconUrl,
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

function buildLinePath(points: readonly number[], width: number, height: number) {
  const insetX = 44;
  const insetTop = 32;
  const insetBottom = 62;
  const step = (width - insetX * 2) / Math.max(1, points.length - 1);

  return points
    .map((value, index) => {
      const x = insetX + index * step;
      const clamped = Math.max(0, Math.min(100, value));
      const y = insetTop + (100 - clamped) * ((height - insetTop - insetBottom) / 100);

      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function closeAreaPath(path: string, width: number, height: number) {
  return `${path} L ${width} ${height} L 0 ${height} Z`;
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

function FrameworkMark({ framework }: { framework: FrameworkResult }) {
  const icon = frameworkIcons[framework.id];
  const isFarm = framework.id === "farm";

  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        className={
          "grid size-8 shrink-0 place-items-center border bg-black " +
          (isFarm ? "border-white/36" : "border-white/12")
        }
      >
        <img
          alt=""
          aria-hidden
          className={
            "max-h-4 max-w-4 brightness-0 invert " + (isFarm ? "opacity-95" : "opacity-54")
          }
          src={icon}
        />
      </span>
      <span className="min-w-0">
        <span
          className={
            "block truncate font-mono text-[11px] font-medium uppercase tracking-normal " +
            (isFarm ? "text-white" : "text-white/70")
          }
        >
          {framework.label}
        </span>
        <span className="mt-1 block truncate font-mono text-[9px] tracking-normal text-white/42">
          {framework.version}
        </span>
      </span>
    </span>
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
  const height = 330;
  const closestCompetitor = chartMetrics.map(([key]) => getBestCompetitor(key).metrics[key].median);
  const farmIndex = chartMetrics.map(([key]) => {
    const best = getMetricMinimum(key);

    return (best / farmResult.metrics[key].median) * 100;
  });
  const competitorIndex = chartMetrics.map(([key], index) => {
    const best = getMetricMinimum(key);

    return (best / closestCompetitor[index]) * 100;
  });
  const farmPath = buildLinePath(farmIndex, width, height);
  const competitorPath = buildLinePath(competitorIndex, width, height);

  return (
    <div className="relative col-span-full overflow-hidden bg-black">
      <div className="relative z-10 max-w-xl px-6 pt-6 sm:px-12 sm:pt-12">
        <span className="flex items-center gap-2 font-mono text-[10px] font-normal uppercase tracking-normal text-white/46">
          <Activity aria-hidden className="size-4" strokeWidth={1.5} />
          Activity feed
        </span>

        <p className="my-6 text-2xl font-medium leading-tight tracking-normal text-white sm:text-3xl">
          A real comparison graph, not a table pretending to be one.{" "}
          <span className="text-white/42">Higher line means closer to fastest.</span>
        </p>
      </div>

      <div className="relative h-[24rem] sm:h-[28rem]">
        <svg
          aria-label="Farm.js benchmark comparison area chart"
          className="absolute inset-x-0 bottom-0 h-full w-full text-white"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <linearGradient id="farmBenchmarkFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
              <stop offset="55%" stopColor="currentColor" stopOpacity="0.08" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="competitorBenchmarkFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
              <stop offset="70%" stopColor="currentColor" stopOpacity="0.03" />
            </linearGradient>
          </defs>
          {[75, 150, 225, 300].map((y) => (
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
          {chartMetrics.map(([, label], index) => {
            const x = 44 + (index * (width - 88)) / Math.max(1, chartMetrics.length - 1);

            return (
              <g key={label}>
                <line
                  stroke="currentColor"
                  strokeOpacity="0.06"
                  strokeWidth="1"
                  x1={x}
                  x2={x}
                  y1="0"
                  y2={height}
                />
                <text
                  fill="currentColor"
                  fillOpacity="0.4"
                  fontFamily="var(--font-geist-mono, monospace)"
                  fontSize="10"
                  textAnchor={index === 0 ? "start" : index === chartMetrics.length - 1 ? "end" : "middle"}
                  x={x}
                  y={height - 14}
                >
                  {label}
                </text>
              </g>
            );
          })}
          <path d={closeAreaPath(competitorPath, width, height)} fill="url(#competitorBenchmarkFill)" />
          <path
            d={competitorPath}
            fill="none"
            stroke="currentColor"
            strokeDasharray="7 7"
            strokeOpacity="0.28"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <path d={closeAreaPath(farmPath, width, height)} fill="url(#farmBenchmarkFill)" />
          <path
            d={farmPath}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.9"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div className="absolute bottom-16 left-6 right-6 z-10 flex flex-wrap gap-3 sm:left-12 sm:right-12">
          <span className="inline-flex items-center gap-2 border border-white/14 bg-black/80 px-3 py-1.5 font-mono text-[9px] uppercase tracking-normal text-white/62 backdrop-blur">
            <span className="h-0.5 w-6 bg-white" />
            Farm.js
          </span>
          <span className="inline-flex items-center gap-2 border border-white/14 bg-black/80 px-3 py-1.5 font-mono text-[9px] uppercase tracking-normal text-white/42 backdrop-blur">
            <span className="h-0.5 w-6 border-t border-dashed border-white/42" />
            Closest rival per metric
          </span>
        </div>
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
            <dt className="font-mono text-[8px] font-normal uppercase tracking-normal text-white/42">
              {label}
            </dt>
            <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
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
            </dd>
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
