import { CompilerComparison } from "../components/compiler-comparison";
import { CompilerEdgeLab } from "../components/compiler-edge-lab";

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

      <footer className="footnote">
        <span>MEASURED, NOT ESTIMATED</span>
        <p>
          Run <code>pnpm --filter farm-react-compiler-example experiment</code>
          to build the production app and assert every result above in Chromium.
        </p>
      </footer>
    </main>
  );
}
