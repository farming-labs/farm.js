import { ExternalLink, Gauge } from "lucide-react";
import nextIconUrl from "simple-icons/icons/nextdotjs.svg?url";
import nuxtIconUrl from "simple-icons/icons/nuxt.svg?url";
import svelteIconUrl from "simple-icons/icons/svelte.svg?url";
import tanstackIconUrl from "simple-icons/icons/tanstack.svg?url";
import farmingLabsLogoUrl from "../../assets/farming-labs-logo-dark.svg?url";
import { benchmarkReport, formatBenchmarkDuration } from "../../lib/framework-benchmark";

const benchmarkLinks = {
  methodology: "https://github.com/farm-js/farm.js/blob/main/benchmarks/frameworks/README.md",
  results: "https://github.com/farm-js/farm.js/blob/main/benchmarks/frameworks/results/latest.json",
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
type MetricDefinition = {
  key: MetricKey;
  label: string;
  detail: string;
  valueType: "duration" | "bytes";
  showP95?: boolean;
};

type ReportProvenance = {
  inputs?: { readonly sha256: string };
  methodology: { readonly burnInRounds?: number };
  revision: { readonly workspaceDirty?: boolean };
};

const reportProvenance = benchmarkReport as typeof benchmarkReport & ReportProvenance;

const metrics = [
  {
    key: "devFirstPageMs",
    label: "First dev page",
    detail: "Spawn → rendered 200",
    valueType: "duration",
  },
  {
    key: "devWarmResponseMs",
    label: "Warm dev",
    detail: `p50 / p95 after ${benchmarkReport.methodology.warmupRequestsPerRun} warmups`,
    valueType: "duration",
    showP95: true,
  },
  {
    key: "buildMs",
    label: "Fixture build",
    detail: "Project cache cleared → exit",
    valueType: "duration",
  },
  {
    key: "productionBootMs",
    label: "Production boot",
    detail: "Spawn → rendered 200",
    valueType: "duration",
  },
  {
    key: "productionResponseMs",
    label: "SSR response",
    detail: "p50 / p95, loopback",
    valueType: "duration",
    showP95: true,
  },
  {
    key: "responseBytes",
    label: "HTML payload",
    detail: "Median full body",
    valueType: "bytes",
  },
] as const satisfies readonly MetricDefinition[];

function formatRunDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}

function formatByteCount(bytes: number) {
  if (bytes >= 1024) {
    return (bytes / 1024).toFixed(1) + " KB";
  }

  return Math.round(bytes) + " B";
}

function formatMetricValue(metric: MetricDefinition, value: number) {
  return metric.valueType === "bytes" ? formatByteCount(value) : formatBenchmarkDuration(value);
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

function FrameworkIdentity({
  framework,
  emphasized,
}: {
  framework: FrameworkResult;
  emphasized: boolean;
}) {
  const icon = frameworkIcons[framework.id];

  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center border border-white/12 bg-black">
        <img
          alt=""
          aria-hidden
          className={
            "max-h-4 max-w-4 brightness-0 invert " + (emphasized ? "opacity-90" : "opacity-58")
          }
          src={icon}
        />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-[11px] font-medium uppercase tracking-normal text-white/88">
            {framework.label}
          </span>
          <span className="font-mono text-[9px] tracking-normal text-white/48">
            {framework.version}
          </span>
        </span>
        <span className="mt-1 block font-mono text-[9px] leading-4 tracking-normal text-white/48">
          {framework.stack}
        </span>
      </span>
    </span>
  );
}

function getMetricMaximum(key: MetricKey) {
  return Math.max(...benchmarkReport.frameworks.map((framework) => framework.metrics[key].median));
}

function getMetricMinimum(key: MetricKey) {
  return Math.min(...benchmarkReport.frameworks.map((framework) => framework.metrics[key].median));
}

function MetricReading({
  framework,
  metric,
}: {
  framework: FrameworkResult;
  metric: MetricDefinition;
}) {
  const result = framework.metrics[metric.key];
  const isTiming = metric.valueType === "duration";
  const maximum = isTiming ? getMetricMaximum(metric.key) : 0;
  const minimum = isTiming ? getMetricMinimum(metric.key) : 0;
  const isBest = isTiming && result.median === minimum;
  const width = isTiming ? Math.max(5, (result.median / maximum) * 100) : 0;

  return (
    <>
      <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span
          className={
            "font-mono text-sm font-medium tabular-nums tracking-normal " +
            (isBest ? "text-white" : "text-white/72")
          }
        >
          {formatMetricValue(metric, result.median)}
        </span>
        {metric.showP95 ? (
          <span className="font-mono text-[9px] tabular-nums text-white/48">
            p95 {formatMetricValue(metric, result.p95)}
          </span>
        ) : null}
      </span>
      {isTiming ? (
        <span aria-hidden className="mt-2 block h-px w-full overflow-hidden bg-white/8">
          <span
            className={"block h-full " + (isBest ? "bg-white/72" : "bg-white/24")}
            style={{ width: width + "%" }}
          />
        </span>
      ) : (
        <span className="mt-2 block font-mono text-[8px] uppercase tracking-normal text-white/48">
          Context only
        </span>
      )}
    </>
  );
}

function MobileBenchmarkResults() {
  return (
    <div className="farm-top-rule xl:hidden">
      <h3 className="sr-only">Framework benchmark results</h3>
      <ul className="grid gap-px bg-white/12 md:grid-cols-2">
        {benchmarkReport.frameworks.map((framework, index) => {
          const isFarm = framework.id === "farm";
          const isOddLastCard =
            benchmarkReport.frameworks.length % 2 === 1 &&
            index === benchmarkReport.frameworks.length - 1;

          return (
            <li
              key={framework.id}
              className={
                "relative p-5 sm:p-6 " +
                (isFarm ? "bg-white/[0.045]" : "bg-black") +
                (isOddLastCard ? " md:col-span-2" : "")
              }
            >
              {isFarm ? (
                <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-white" />
              ) : null}
              <h4>
                <FrameworkIdentity emphasized={isFarm} framework={framework} />
              </h4>

              <dl className="mt-5 grid grid-cols-2 border-l border-t border-white/10 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
                {metrics.map((metric) => (
                  <div
                    key={metric.key}
                    className="min-w-0 border-b border-r border-white/10 px-3 py-3.5"
                  >
                    <dt className="font-mono font-normal uppercase tracking-normal">
                      <span className="block text-[9px] leading-4 text-white/62">
                        {metric.label}
                      </span>
                      <span className="mt-2 block text-[8px] leading-4 text-white/48">
                        {metric.detail}
                      </span>
                    </dt>
                    <dd className="mt-2">
                      <MetricReading framework={framework} metric={metric} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DesktopBenchmarkResults() {
  return (
    <div
      aria-label="Framework benchmark results. Scroll horizontally to view every metric."
      className="farm-top-rule hidden overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white xl:block"
      role="region"
      tabIndex={0}
    >
      <table className="w-full min-w-[72rem] border-collapse text-left">
        <caption className="sr-only">
          Median framework timings and HTML response size for the small dynamic server-rendered
          fixture. Lower timing values are better; payload size is contextual.
        </caption>
        <thead>
          <tr className="border-b border-white/12 bg-white/[0.025]">
            <th
              className="w-[15rem] border-r border-white/12 px-5 py-4 font-mono text-[9px] font-normal uppercase tracking-normal text-white/52"
              scope="col"
            >
              Framework / pinned stack
            </th>
            {metrics.map((metric) => (
              <th
                key={metric.key}
                className="min-w-[8.75rem] border-r border-white/12 px-4 py-4 font-normal last:border-r-0"
                scope="col"
              >
                <span className="block font-mono text-[9px] uppercase tracking-normal text-white/58">
                  {metric.label}
                </span>
                <span className="mt-1 block font-mono text-[8px] font-normal uppercase leading-3 tracking-normal text-white/48">
                  {metric.detail}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {benchmarkReport.frameworks.map((framework) => {
            const isFarm = framework.id === "farm";

            return (
              <tr
                key={framework.id}
                className={
                  "border-b border-white/10 last:border-b-0 " +
                  (isFarm ? "bg-white/[0.045]" : "bg-black")
                }
              >
                <th className="relative border-r border-white/12 px-5 py-5 font-normal" scope="row">
                  {isFarm ? (
                    <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-white" />
                  ) : null}
                  <FrameworkIdentity emphasized={isFarm} framework={framework} />
                </th>

                {metrics.map((metric) => (
                  <td
                    key={metric.key}
                    className="border-r border-white/12 px-4 py-5 last:border-r-0"
                  >
                    <MetricReading framework={framework} metric={metric} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BenchmarkSection() {
  const farm = benchmarkReport.frameworks.find((framework) => framework.id === "farm");
  const firstDevPage = farm ? formatBenchmarkDuration(farm.metrics.devFirstPageMs.median) : "—";
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
          <div className="max-w-3xl">
            <p className="font-mono text-[10px] font-normal uppercase tracking-normal text-white/52">
              Measured, not guessed
            </p>
            <h2
              className="mt-4 text-balance text-3xl font-medium leading-[1.06] tracking-normal text-white sm:text-4xl"
              id="framework-benchmark-title"
            >
              Farm.js reached its first rendered dev page in a median of {firstDevPage}
            </h2>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-white/48 sm:text-base sm:leading-7">
              Farm.js, Next.js, SvelteKit, Nuxt, and TanStack Start ran the same small dynamic-SSR
              fixture on one machine. Startup, fixture-project build, warm response, and payload
              results are published side by side with every raw sample.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            <BenchmarkLink href={benchmarkLinks.methodology}>Methodology</BenchmarkLink>
            <BenchmarkLink href={benchmarkLinks.results}>Raw samples</BenchmarkLink>
          </div>
        </div>
      </div>

      <MobileBenchmarkResults />
      <DesktopBenchmarkResults />

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
          hydration, HMR, network, and real production-app behavior. Generated framework caches were
          cleared while the OS cache stayed warm
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
