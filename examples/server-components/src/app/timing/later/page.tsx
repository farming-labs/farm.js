import { Link } from "@farm.js/core/client";
import { InteractionIsland } from "../../../components/timing/interaction";
import { VisibleIsland } from "../../../components/timing/visible";

// Every island here hydrates later, so in islands mode the page starts with the boot entry and
// loads the client runtime when one is due, or when a link is about to be followed.
export default function TimingLaterPage() {
  return (
    <section>
      <h1>Timing later</h1>
      <InteractionIsland />
      <p>
        <Link href="/timing">To timing</Link>
      </p>
      <div style={{ height: "300vh" }} />
      <VisibleIsland />
    </section>
  );
}
