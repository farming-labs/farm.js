import { Suspense } from "react";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function Slow() {
  await wait(600);
  return <p data-testid="slow-content">Slow content arrived</p>;
}

// The root layout returns a whole <html> document: its pages stream like any other.
export default function StreamPage() {
  return (
    <main>
      <h1>Stream</h1>
      <Suspense fallback={<p data-testid="slow-fallback">Loading slow content</p>}>
        <Slow />
      </Suspense>
    </main>
  );
}
