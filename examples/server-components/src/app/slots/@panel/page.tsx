import { Counter } from "../../../components/counter";

const serverOnlyNote = "SERVER_SLOT_MARKER_6f1c";

export default function PanelSlot() {
  return (
    <div>
      <p data-testid="slot-note">{serverOnlyNote}</p>
      <Counter start={0} label="Slot clicks" />
    </div>
  );
}
