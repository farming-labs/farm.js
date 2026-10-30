import { Suspense } from "react";
import { Counter } from "../../components/counter";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function Slow() {
  await wait(800);
  return (
    <div>
      <p data-testid="slow-content">Slow content arrived</p>
      <Counter start={0} label="Late" />
    </div>
  );
}

export default function StreamPage() {
  return (
    <section>
      <h1>Stream</h1>
      <Counter start={0} label="Early" />
      <Suspense fallback={<p data-testid="slow-fallback">Loading slow content</p>}>
        <Slow />
      </Suspense>
    </section>
  );
}
