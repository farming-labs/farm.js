import { Picker } from "../../../components/wire/picker";

export const dynamic = "force-dynamic";

// A plain function cannot reach a client component: the render fails, as under RSC.
export default function FunctionPropPage() {
  return (
    <section>
      <h1>Function prop</h1>
      <Picker onPick={() => {}} />
    </section>
  );
}
