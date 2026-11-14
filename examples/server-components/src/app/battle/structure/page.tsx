import { ClientItem } from "../../../components/battle/structure";

export default function StructurePage() {
  return (
    <section>
      <h1>Structure</h1>
      <ul data-testid="list">
        <ClientItem label="first" />
      </ul>
    </section>
  );
}
