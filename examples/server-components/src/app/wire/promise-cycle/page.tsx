import { Suspense } from "react";
import type { Holder } from "./actions";
import { HolderView } from "./holder-view";

export default function PromiseCyclePage() {
  const holder: Holder = { name: "holder" };
  holder.self = Promise.resolve(holder);
  return (
    <section>
      <h1>Promise cycle</h1>
      <Suspense fallback={<p>Loading</p>}>
        <HolderView holder={holder} />
      </Suspense>
    </section>
  );
}
