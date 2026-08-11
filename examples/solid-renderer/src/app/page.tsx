import { GreetingPanel } from "../features/greeting/greeting-panel";

export default function HomePage() {
  return (
    <main class="page-shell">
      <section class="hero">
        <div class="eyebrow">
          <span>00</span>
          <span>FARMJS / Solid renderer</span>
        </div>

        <h1>
          Solid UI. <span>FARMJS server.</span>
        </h1>

        <GreetingPanel />

        <nav class="links" aria-label="Project resources">
          <a href="https://farm.js.dev">Docs</a>
          <span aria-hidden="true">/</span>
          <a href="https://github.com/farming-labs/farm.js">GitHub</a>
        </nav>
      </section>
    </main>
  );
}
