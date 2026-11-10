import { Suspense } from "react";
import { notFound } from "@farm.js/core/navigation";

export const dynamic = "force-dynamic";

async function LateMissing(): Promise<never> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  notFound();
}

// notFound() after the shell has streamed: the status is already 200.
export default function StreamedMissingPage() {
  return (
    <section>
      <h1>Streamed missing</h1>
      <Suspense fallback={<p>Loading</p>}>
        <LateMissing />
      </Suspense>
    </section>
  );
}
