import type { Metadata } from "@farm.js/core";
import { Suspense } from "leaf";
import { loadCropsSlowly } from "../../server/slow-crops";

export const metadata: Metadata = { title: "Streaming" };

// An async component renders on the server only, so this page doesn't hydrate.
async function SlowCropList() {
  const crops = await loadCropsSlowly();
  return (
    <ul id="slow-crops">
      {crops.map((crop) => (
        <li>{crop}</li>
      ))}
    </ul>
  );
}

export default function StreamingPage() {
  return (
    <section>
      <h1>Streaming</h1>
      <p id="sent-first">This arrives first. The list below waits 400 ms for its data.</p>
      <Suspense>
        <SlowCropList />
      </Suspense>
    </section>
  );
}
