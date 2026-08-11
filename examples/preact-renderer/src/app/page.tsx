import { ResourceLinks } from "../components/resource-links";
import { GreetingPanel } from "../features/greeting/greeting-panel";

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div className="eyebrow">
          <span>00</span>
          <span>FARMJS / Preact renderer</span>
        </div>

        <h1>
          Preact UI. <span>FARMJS server.</span>
        </h1>

        <GreetingPanel />
        <ResourceLinks className="links" />
      </section>
    </main>
  );
}
