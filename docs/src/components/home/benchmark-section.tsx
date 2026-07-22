import { Activity, ExternalLink, Gauge } from "lucide-react";
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

const proofMetrics = [
  ["devFirstPageMs", "dev start"],
  ["devWarmResponseMs", "warm dev"],
  ["buildMs", "build"],
  ["productionBootMs", "prod boot"],
  ["productionResponseMs", "SSR p50"],
  ["responseBytes", "HTML"],
] as const satisfies readonly (readonly [MetricKey, string])[];

const graphMetrics = [
  ["devFirstPageMs", "Dev page"],
  ["buildMs", "Build"],
  ["productionBootMs", "Prod boot"],
  ["productionResponseMs", "SSR p50"],
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

function getMetricMaximum(key: MetricKey) {
  return Math.max(...benchmarkReport.frameworks.map((framework) => framework.metrics[key].median));
}

function getBestCompetitor(key: MetricKey) {
  return competitorResults.reduce((best, framework) =>
    framework.metrics[key].median < best.metrics[key].median ? framework : best,
  );
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

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-white/10 px-4 py-4 sm:border-l sm:border-t-0">
      <dt className="font-mono text-[8px] font-normal uppercase tracking-normal text-white/42">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-sm font-medium tabular-nums tracking-normal text-white">
        {value}
      </dd>
    </div>
  );
}

function ProofBand() {
  if (!farmResult) {
    return null;
  }

  const wins = proofMetrics.filter(([key]) => farmResult.metrics[key].median === getMetricMinimum(key));
  const buildRival = getBestCompetitor("buildMs");
  const buildAdvantage = buildRival.metrics.buildMs.median / farmResult.metrics.buildMs.median;
  const nextResult = benchmarkReport.frameworks.find((framework) => framework.id === "next");
  const bootAdvantage = nextResult
    ? nextResult.metrics.productionBootMs.median / farmResult.metrics.productionBootMs.median
    : 0;

  return (
    <div className="farm-top-rule">
      <div className="grid gap-px bg-white/12 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="relative bg-black px-6 py-10 text-center sm:px-10 sm:py-14">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.13] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:48px_48px]"
          />
          <div className="relative">
            <p className="inline-flex items-center gap-2 border border-white/12 bg-black px-3 py-1.5 font-mono text-[9px] font-normal uppercase tracking-normal text-white/52">
              <Activity aria-hidden className="size-3.5" strokeWidth={1.5} />
              Uptime-style proof, measured as framework speed
            </p>
            <p className="mt-7 text-balance text-5xl font-medium leading-none tracking-[-0.05em] text-white sm:text-7xl lg:text-8xl">
              {wins.length}/{proofMetrics.length} leads
            </p>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-white/50 sm:text-base sm:leading-7">
              Same dynamic SSR fixture. Same machine. Farm leads startup, warm dev, build,
              production boot, and payload while staying within 0.03ms of SvelteKit on SSR p50.
            </p>
          </div>
        </div>

        <dl className="grid bg-black sm:grid-cols-3 lg:block">
          <MetricPill
            label={"Fastest measured build"}
            value={formatMetricValue("buildMs", farmResult.metrics.buildMs.median)}
          />
          <MetricPill
            label={"Build vs " + buildRival.label}
            value={formatRatio(buildAdvantage) + " faster"}
          />
          <MetricPill
            label={"Boot vs Next.js"}
            value={bootAdvantage ? formatRatio(bootAdvantage) + " faster" : "—"}
          />
        </dl>
      </div>
    </div>
  );
}

function ComparisonGraph() {
  if (!farmResult) {
    return null;
  }

  return (
    <div className="farm-top-rule grid gap-px bg-white/12 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="bg-black p-5 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[9px] font-normal uppercase tracking-normal text-white/46">
              Comparison graph
            </p>
            <h3 className="mt-2 text-xl font-medium tracking-normal text-white sm:text-2xl">
              Lower bars are faster. Farm stays pinned left.
            </h3>
          </div>
          <p className="max-w-sm font-mono text-[9px] font-normal uppercase leading-4 tracking-normal text-white/42 sm:text-right">
            Median values from {benchmarkReport.methodology.runs} runs. Raw samples stay linked.
          </p>
        </div>

        <div className="mt-7 space-y-7">
          {graphMetrics.map(([key, label]) => {
            const maximum = getMetricMaximum(key);
            const farmValue = farmResult.metrics[key].median;

            return (
              <div key={key}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h4 className="font-mono text-[10px] font-normal uppercase tracking-normal text-white/62">
                    {label}
                  </h4>
                  <p className="font-mono text-[10px] tabular-nums text-white/52">
                    Farm {formatMetricValue(key, farmValue)}
                  </p>
                </div>
                <div className="space-y-2.5">
                  {benchmarkReport.frameworks.map((framework) => {
                    const isFarm = framework.id === "farm";
                    const value = framework.metrics[key].median;
                    const width = Math.max(3, (value / maximum) * 100);

                    return (
                      <div
                        key={framework.id}
                        className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.75rem] items-center gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_5.5rem]"
                      >
                        <span
                          className={
                            "truncate font-mono text-[9px] font-normal uppercase tracking-normal " +
                            (isFarm ? "text-white" : "text-white/48")
                          }
                        >
                          {framework.label}
                        </span>
                        <span className="block h-2 overflow-hidden bg-white/[0.07]">
                          <span
                            className={
                              "block h-full " + (isFarm ? "bg-white" : "bg-white/24")
                            }
                            style={{ width: width + "%" }}
                          />
                        </span>
                        <span
                          className={
                            "text-right font-mono text-[9px] tabular-nums " +
                            (isFarm ? "text-white" : "text-white/46")
                          }
                        >
                          {formatMetricValue(key, value)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-px bg-white/12 sm:grid-cols-2 xl:grid-cols-1">
        {competitorResults.map((framework) => {
          const buildAdvantage =
            framework.metrics.buildMs.median / farmResult.metrics.buildMs.median;
          const devAdvantage =
            framework.metrics.devFirstPageMs.median / farmResult.metrics.devFirstPageMs.median;

          return (
            <article key={framework.id} className="bg-black p-5 sm:p-6">
              <FrameworkMark framework={framework} />
              <div className="mt-5 grid grid-cols-2 gap-px bg-white/12">
                <div className="bg-black p-3">
                  <p className="font-mono text-[8px] uppercase tracking-normal text-white/42">
                    Build edge
                  </p>
                  <p className="mt-1 font-mono text-base font-medium tabular-nums text-white">
                    {formatRatio(buildAdvantage)}
                  </p>
                </div>
                <div className="bg-black p-3">
                  <p className="font-mono text-[8px] uppercase tracking-normal text-white/42">
                    Dev edge
                  </p>
                  <p className="mt-1 font-mono text-base font-medium tabular-nums text-white">
                    {formatRatio(devAdvantage)}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ProofMetricStrip() {
  if (!farmResult) {
    return null;
  }

  return (
    <div className="farm-top-rule grid gap-px bg-white/12 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {proofMetrics.map(([key, label]) => {
        const farmValue = farmResult.metrics[key].median;
        const minimum = getMetricMinimum(key);
        const isLead = farmValue === minimum;
        const rival = isLead ? getBestCompetitor(key) : undefined;
        const ratio = rival ? rival.metrics[key].median / farmValue : minimum / farmValue;

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

      <ProofBand />
      <ComparisonGraph />
      <ProofMetricStrip />

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
