import * as Parts from "../../../components/namespace";

// Client components used through a namespace import.
export default function NamespacePage() {
  return (
    <section>
      <h1>Namespace</h1>
      <Parts.Badge label="namespaced" />
    </section>
  );
}
