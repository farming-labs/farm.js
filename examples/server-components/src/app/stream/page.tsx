import { Suspense } from "react";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function Slow() {
  await wait(800);
  return <p data-testid="slow-content">Slow content arrived</p>;
}

export default function StreamPage() {
  return (
    <section>
      <h1>Stream</h1>
      <Suspense fallback={<p data-testid="slow-fallback">Loading slow content</p>}>
        <Slow />
      </Suspense>
    </section>
  );
}
