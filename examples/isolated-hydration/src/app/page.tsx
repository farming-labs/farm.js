import { IdleIsland } from "../components/idle-island";
import { VisibleIsland } from "../components/visible-island";

export default function HomePage() {
  return (
    <main>
      <h1>Isolated hydration demo</h1>
      <IdleIsland />
      <div style={{ height: "2400px" }} data-testid="spacer" />
      <VisibleIsland />
    </main>
  );
}
