import { Suspense } from "react";
import { Counter } from "../../components/counter";
import { heldUntilReleased, releaseHeld } from "../../lib/stream-gate";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const TOKEN = /^[a-zA-Z0-9_-]{1,80}$/;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// `?hold=<token>` keeps this content back until a request for `?release=<token>`, so a test can
// act on the page while its body streams instead of racing the 800 ms timer.
async function Slow({ searchParams }: { searchParams: SearchParams }) {
  const { hold, release } = await searchParams;
  if (typeof release === "string" && TOKEN.test(release)) releaseHeld(release);
  await (typeof hold === "string" && TOKEN.test(hold) ? heldUntilReleased(hold) : wait(800));
  return (
    <div>
      <p data-testid="slow-content">Slow content arrived</p>
      <Counter start={0} label="Late" />
    </div>
  );
}

export default function StreamPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <section>
      <h1>Stream</h1>
      <Counter start={0} label="Early" />
      <Suspense fallback={<p data-testid="slow-fallback">Loading slow content</p>}>
        <Slow searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
