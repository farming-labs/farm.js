import { Link } from "@farm.js/core/client";
import { InteractionIsland } from "../../../components/timing/interaction";

// Its one island waits for a click, and so do the ones on the page it links to: in islands mode,
// React DOM and islx load with that click, not with the client runtime.
export default function TimingQuietPage() {
  return (
    <section>
      <h1>Timing quiet</h1>
      <InteractionIsland />
      <p>
        <Link href="/timing/later">To timing later</Link>
      </p>
    </section>
  );
}
