import type { Metadata } from "@farm.js/core";
import { Suspense } from "leaf";
import { readHarvest } from "../../server/harvest";

export const metadata: Metadata = { title: "Harvest" };

// An async component renders on the server only, so this page doesn't hydrate.
async function HarvestReport() {
  const harvest = await readHarvest();
  return (
    <ul id="harvest">
      {harvest.map((crop) => (
        <li>
          {crop.name}: {crop.tonnes} t
        </li>
      ))}
    </ul>
  );
}

export default function HarvestPage() {
  return (
    <section>
      <h1>Harvest</h1>
      <p id="before-report">Farm sends this before the report is ready.</p>
      <Suspense>
        <HarvestReport />
      </Suspense>
    </section>
  );
}
