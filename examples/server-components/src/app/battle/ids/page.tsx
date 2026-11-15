import { IdField } from "../../../components/battle/id-field";

export default function IdsPage() {
  return (
    <section>
      <h1>Ids</h1>
      <IdField label="First" />
      <p>Between the fields</p>
      <IdField label="Second" />
    </section>
  );
}
