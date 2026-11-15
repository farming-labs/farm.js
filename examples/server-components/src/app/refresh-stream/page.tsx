import { Link } from "@farm.js/core/client";
import { Suspense } from "react";
import { LaterNote } from "./later-note";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The boundary's content arrives in the shell's flush with the island still waiting on its note,
// which a later flush reveals.
export default async function RefreshStreamPage({
  searchParams,
}: {
  searchParams: Promise<{ visit?: string }>;
}) {
  const visit = Number((await searchParams).visit ?? 0);
  return (
    <section>
      <h1>Refresh stream</h1>
      <p data-testid="visit">{`visit ${visit}`}</p>
      <Link href={`/refresh-stream?visit=${visit + 1}`}>Next visit</Link>
      <Suspense fallback={<p>Loading</p>}>
        <LaterNote note={wait(100).then(() => "note arrived")} />
      </Suspense>
    </section>
  );
}
