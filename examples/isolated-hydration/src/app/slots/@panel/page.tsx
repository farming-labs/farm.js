import { CounterIsland } from "../../../components/counter-island";

export default function PanelSlot() {
  // Deliberately the same client module the root layout isolates, so the slot
  // renders a module that the transform has rewritten into a boundary.
  return (
    <div data-testid="panel-slot">
      <CounterIsland start={100} />
    </div>
  );
}
