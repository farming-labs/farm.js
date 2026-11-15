import { Clicker } from "../../../components/battle/crash";
import { Outer } from "../../../components/battle/nested";

export default function NestedPage() {
  return (
    <section>
      <h1>Nested</h1>
      <Outer>
        <p>server text inside the outer island</p>
        <Clicker name="inside" />
      </Outer>
    </section>
  );
}
