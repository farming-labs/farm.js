import { CompilerComparison } from "../components/compiler-comparison";
import { CompilerEdgeLab } from "../components/compiler-edge-lab";
import { CommonSyntaxExperiment } from "../components/common-syntax-experiment";
import { HeavyInteractionBenchmark } from "../components/heavy-interaction-benchmark";
import { StaticBindingExperiment } from "../components/static-binding-experiment";

export default function HomePage() {
  return (
    <main className="page-shell">
      <header className="hero">
        <div className="eyebrow">
          <span>EXPERIMENT 01</span>
          <span>REACT / AOT LOCAL STATE</span>
        </div>
        <h1>
          Same React API.
          <span> Less update work.</span>
        </h1>
        <p className="hero-copy">
          Click both counters. They produce the same DOM result, but the
          compiled path updates its prepared bindings without running the
          component again.
        </p>
      </header>

      <CompilerComparison />

      <section className="why-compiler" aria-labelledby="why-title">
        <div className="section-heading">
          <span>WHY THIS COMPILER EXISTS</span>
          <h2 id="why-title">Move known update work to the build.</h2>
        </div>
        <div className="reason-grid">
          <article>
            <span>01 / FIND</span>
            <h3>Trace dependencies once</h3>
            <p>
              The build records which state cell controls each eligible text or
              attribute target.
            </p>
          </article>
          <article>
            <span>02 / PATCH</span>
            <h3>Skip repeated tree work</h3>
            <p>
              A local update patches only those prepared targets without
              rerunning the component body.
            </p>
          </article>
          <article>
            <span>03 / FALL BACK</span>
            <h3>Keep React semantics</h3>
            <p>
              React still owns SSR, hydration, events, props, placement, and
              every structure the compiler cannot prove safe.
            </p>
          </article>
        </div>
      </section>

      <CompilerEdgeLab />

      <CommonSyntaxExperiment />

      <StaticBindingExperiment />

      <HeavyInteractionBenchmark />

      <section
        className="benchmark-report"
        aria-labelledby="benchmark-report-title"
      >
        <header>
          <div>
            <span>REFERENCE RUN / APPLE M1 / CHROMIUM 145</span>
            <h2 id="benchmark-report-title">
              The flag changed the update path.
            </h2>
          </div>
          <strong>8.5×</strong>
        </header>
        <dl>
          <div>
            <dt>Compiler off median</dt>
            <dd>0.170 ms</dd>
          </div>
          <div>
            <dt>Compiler on median</dt>
            <dd>0.020 ms</dd>
          </div>
          <div>
            <dt>Median reduction</dt>
            <dd>88.2%</dd>
          </div>
          <div>
            <dt>Gzip cost</dt>
            <dd>+1,268 B</dd>
          </div>
        </dl>
        <p>
          This measures button dispatch through observed DOM mutation for a
          large static tree with sparse bindings. It is deliberately favorable
          to AOT and does not include layout, paint, network work, or
          unsupported React structures.
        </p>
      </section>

      <footer className="footnote">
        <span>MEASURED, NOT ESTIMATED</span>
        <p>
          Run <code>pnpm --filter farm-react-compiler-example experiment</code>{" "}
          for correctness or <code>experiment:heavy</code> for the
          compiler-on/off production benchmark.
        </p>
      </footer>
    </main>
  );
}
