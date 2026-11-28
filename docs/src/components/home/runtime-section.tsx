import { ArrowUpRight, Cpu, Layers3 } from "../icons";
import {
  compilerBenchmark,
  compilerSwapSpeedup,
  islandsBenchmark,
  jsFrameworkBenchmark,
} from "../../lib/runtime-benchmarks";
import { ComparisonPanel } from "./benchmark-section";

const islandsSaving = 1 - islandsBenchmark.firstLoadKb.islands / islandsBenchmark.firstLoadKb.rsc;
const blogThroughput =
  islandsBenchmark.blogRequestsPerSecond.islands / islandsBenchmark.blogRequestsPerSecond.rsc;
type Bar = {
  label: string;
  value: number;
  display: string;
  /** Farm's own result: the one solid bar in its row group. */
  farm: boolean;
};

function FigureCaption({ children }: { children: string }) {
  return (
    <figcaption className="font-mono text-[10px] uppercase tracking-normal text-white/42">
      {children}
    </figcaption>
  );
}

/** One measured value: its label, a bar to scale against `max`, and the number itself. */
function BarRow({ bar, max }: { bar: Bar; max: number }) {
  return (
    <li className="grid grid-cols-[6.75rem_minmax(0,1fr)_3.75rem] items-center gap-3 sm:grid-cols-[7.5rem_minmax(0,1fr)_4rem]">
      <span
        className={
          "truncate font-mono text-[10px] uppercase tracking-normal " +
          (bar.farm ? "text-white" : "text-white/46")
        }
      >
        {bar.label}
      </span>
      <span aria-hidden className="relative block h-2">
        <span
          className={
            "absolute inset-y-0 left-0 min-w-[2px] " +
            (bar.farm ? "bg-white/90" : "border border-dashed border-white/32")
          }
          style={{ width: `${(bar.value / max) * 100}%` }}
        />
      </span>
      <span
        className={
          "text-right font-mono text-xs tabular-nums tracking-normal " +
          (bar.farm ? "text-white" : "text-white/52")
        }
      >
        {bar.display}
      </span>
    </li>
  );
}

function BarGroup({ caption, bars }: { caption: string; bars: readonly Bar[] }) {
  const max = Math.max(...bars.map((bar) => bar.value));
  return (
    <figure className="grid gap-3">
      <FigureCaption>{caption}</FigureCaption>
      <ul className="grid gap-2">
        {bars.map((bar) => (
          <BarRow key={bar.label} bar={bar} max={max} />
        ))}
      </ul>
    </figure>
  );
}

function CompilerFigure() {
  return (
    <div className="mt-4 flex flex-col justify-center gap-7 py-4 sm:min-h-72">
      <BarGroup
        bars={[
          {
            label: "Plain React",
            value: compilerBenchmark.swap.reactMs,
            display: compilerBenchmark.swap.reactMs.toFixed(2) + " ms",
            farm: false,
          },
          {
            label: "Farm compiler",
            value: compilerBenchmark.swap.compiledMs,
            display: compilerBenchmark.swap.compiledMs.toFixed(2) + " ms",
            farm: true,
          },
        ]}
        caption="Swap two of 1,000 rows · click to DOM write, p50"
      />
      <BarGroup
        bars={jsFrameworkBenchmark.entries.map((entry) => ({
          label: entry.label,
          value: entry.score,
          display: entry.score.toFixed(3),
          farm: entry.id === "farm-react",
        }))}
        caption={`js-framework-benchmark · ${jsFrameworkBenchmark.browser} · score, 1 = fastest`}
      />
    </div>
  );
}

function IslandsFigure() {
  const max = Math.max(...islandsBenchmark.mainThreadMs.map((row) => row.rsc));
  return (
    <figure className="mt-4 flex flex-col justify-center gap-3 py-4 sm:min-h-72">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <FigureCaption>First-load main thread · ms, 4× CPU</FigureCaption>
        <span
          aria-hidden
          className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-normal text-white/46"
        >
          <span className="flex items-center gap-1.5 text-white">
            <span className="h-2 w-4 bg-white/90" />
            Islands
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-4 border border-dashed border-white/32" />
            RSC
          </span>
        </span>
      </div>
      <ul className="grid gap-4">
        {islandsBenchmark.mainThreadMs.map((row) => (
          <li key={row.page}>
            <span className="sr-only">
              {row.page}: {row.islands} ms with islands, {row.rsc} ms with React Server Components.
            </span>
            <ul aria-hidden className="grid gap-1.5">
              <BarRow
                bar={{ label: row.page, value: row.rsc, display: `${row.rsc} ms`, farm: false }}
                max={max}
              />
              <BarRow
                bar={{ label: "", value: row.islands, display: `${row.islands} ms`, farm: true }}
                max={max}
              />
            </ul>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function SourceLinks({ links }: { links: readonly { href: string; label: string }[] }) {
  return (
    <span className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
      {links.map((link) => (
        <a
          key={link.href}
          className="inline-flex min-h-11 items-center gap-1 font-mono text-[11px] uppercase tracking-normal text-white/62 underline decoration-white/24 underline-offset-4 transition-colors duration-150 hover:text-white hover:decoration-white/60 focus-visible:text-white sm:min-h-0"
          href={link.href}
          {...(link.href.startsWith("http") ? { rel: "noreferrer", target: "_blank" } : {})}
        >
          {link.label}
          <ArrowUpRight aria-hidden className="size-3" strokeWidth={1.5} />
        </a>
      ))}
    </span>
  );
}

export function RuntimeBenchmarkSection() {
  return (
    <section
      aria-labelledby="runtime-benchmark-title"
      className="farm-full-rule grid w-full bg-black lg:grid-cols-2"
      id="runtime-benchmarks"
    >
      <h2 className="sr-only" id="runtime-benchmark-title">
        Runtime benchmarks
      </h2>
      <ComparisonPanel
        description={
          <>
            The same app with the compiler off and on: a swap takes{" "}
            {compilerBenchmark.swap.compiledMs} ms instead of {compilerBenchmark.swap.reactMs} ms.
            On the independent js-framework-benchmark, Farm.js is the fastest React entry and level
            with Solid.
            <SourceLinks
              links={[
                { href: jsFrameworkBenchmark.href, label: "js-framework-benchmark" },
                { href: compilerBenchmark.href, label: "Compiler benchmark" },
              ]}
            />
          </>
        }
        icon={Cpu}
        illustration={<CompilerFigure />}
        label="React compiler"
        title={
          <>
            Row swaps {compilerSwapSpeedup}× faster than plain React.{" "}
            <span className="text-white/42">What it cannot prove safe stays with React.</span>
          </>
        }
      />
      <div className="border-t border-white/12 lg:border-l lg:border-t-0">
        <ComparisonPanel
          description={
            <>
              Islands mode renders server components on islx and hydrates a client component only
              when it is needed: about half the main-thread work of React Flight on pages whose
              client components wait for a click, and {blogThroughput.toFixed(1)}× the requests per
              second on a long blog post. Both engines run the same server components contract
              tests.
              <SourceLinks
                links={[{ href: islandsBenchmark.href, label: "How islands compare" }]}
              />
            </>
          }
          icon={Layers3}
          illustration={<IslandsFigure />}
          label="Server components · islx"
          title={
            <>
              Server components with {Math.round(islandsSaving * 100)}% less JavaScript.{" "}
              <span className="text-white/42">
                {islandsBenchmark.firstLoadKb.islands} KB on first load instead of{" "}
                {islandsBenchmark.firstLoadKb.rsc.toFixed(1)} KB.
              </span>
            </>
          }
        />
      </div>
    </section>
  );
}
