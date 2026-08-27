import { OperationsDashboard } from "../components/operations-dashboard";
import { StandardTableBenchmark } from "../components/standard-table-benchmark";

export default function HomePage() {
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Benchmark navigation">
        <a className="brand" href="#dashboard" aria-label="Farm compiler benchmark home">
          <span className="brand-mark">F</span>
          <span>FARM / AOT</span>
        </a>
        <nav>
          <a className="nav-link nav-link--active" href="#dashboard">
            <span>01</span> Operations
          </a>
          <a className="nav-link" href="#table-benchmark">
            <span>02</span> 1K / 10K rows
          </a>
          <a className="nav-link" href="#methodology">
            <span>03</span> Method
          </a>
        </nav>
        <div className="sidebar-status">
          <span className="status-dot" />
          <div>
            <strong>LOCAL HARNESS</strong>
            <small>production build</small>
          </div>
        </div>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <div>
            <span className="overline">REACT COMPILER / PERFORMANCE LAB</span>
            <strong>Operations control</strong>
          </div>
          <div className="topbar-meta">
            <span>REACT 19</span>
            <span>CHROMIUM</span>
            <span>PRODUCTION</span>
          </div>
        </header>

        <OperationsDashboard />
        <StandardTableBenchmark />

        <section className="methodology" id="methodology" aria-labelledby="methodology-title">
          <div>
            <span className="section-index">03 / METHOD</span>
            <h2 id="methodology-title">Measure the same DOM and the same actions.</h2>
          </div>
          <ol>
            <li>
              <strong>Production builds</strong>
              <span>
                React baseline, static compiler, default hybrid compiler, then a second baseline.
              </span>
            </li>
            <li>
              <strong>Warm before sampling</strong>
              <span>
                Each interaction is exercised before median and p95 timings are collected.
              </span>
            </li>
            <li>
              <strong>Assert correctness</strong>
              <span>
                Every trial verifies DOM results, compiled markers, execution counts, and browser
                errors.
              </span>
            </li>
          </ol>
          <p>
            Run <code>pnpm --filter farm-react-compiler-dashboard-example benchmark</code> from the
            repository root. The runner emits a machine-readable JSON report with environment,
            bundle, correctness, and timing data.
          </p>
        </section>
      </div>
    </main>
  );
}
