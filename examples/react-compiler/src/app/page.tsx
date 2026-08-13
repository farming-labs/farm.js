import { CompilerComparison } from "../components/compiler-comparison";

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

      <footer className="footnote">
        <span>MEASURED IN THE RUNTIME TEST</span>
        <p>
          One update: AOT stays at 1 render / 1 commit. Base React reaches 2
          renders / 2 commits.
        </p>
      </footer>
    </main>
  );
}
