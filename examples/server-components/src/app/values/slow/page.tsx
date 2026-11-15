import { Suspense, use } from "react";

export const dynamic = "force-dynamic";

const reads = new Map<string, Promise<string>>();

// Suspends only when asked to, as an uncached upstream read does. A route that rendered without
// suspending renders the next request synchronously first; one that suspends then renders twice.
function MaybeSlow({ id }: { id?: string }) {
  if (!id) return <p>Read at once</p>;
  let read = reads.get(id);
  if (!read) {
    read = new Promise((resolve) => setTimeout(() => resolve("Read later"), 20));
    reads.set(id, read);
  }
  return <p>{use(read)}</p>;
}

export default function ValuesSlow(props: { search?: Record<string, string> }) {
  return (
    <section>
      <h1>Values slow</h1>
      <Suspense fallback={<p>Reading</p>}>
        <MaybeSlow id={props.search?.slow} />
      </Suspense>
    </section>
  );
}
