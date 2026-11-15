import { IdleIsland } from "../../components/timing/idle";
import { InteractionIsland } from "../../components/timing/interaction";
import { VisibleIsland } from "../../components/timing/visible";

// One island per hydration strategy (export const island in each module). The visible one
// starts below the fold.
export default function TimingPage() {
  return (
    <section>
      <h1>Timing</h1>
      <InteractionIsland />
      <IdleIsland />
      <div style={{ height: "300vh" }} />
      <VisibleIsland />
    </section>
  );
}
