import { Counter } from "../../../components/counter";
import { KindsView } from "./kinds-view";

export default function KindsPage() {
  const form = new FormData();
  form.append("name", "page");
  return (
    <section>
      <h1>Kinds</h1>
      <KindsView
        panels={new Map([["main", <Counter key="main" start={1} label="Panel" />]])}
        symbol={Symbol.for("farm.kinds")}
        error={new Error("kept on the server")}
        items={(function* () {
          yield "a";
          yield "b";
        })()}
        blob={new Blob(["blob"], { type: "text/plain" })}
        form={form}
      />
    </section>
  );
}
