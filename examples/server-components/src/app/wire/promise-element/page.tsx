import { Suspense } from "react";
import { Counter } from "../../../components/counter";
import { Reveal } from "../../../components/wire/reveal";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function card() {
  await wait(50);
  return (
    <strong>
      promised <Counter start={2} label="Promised" />
    </strong>
  );
}

export default function PromiseElementPage() {
  return (
    <section>
      <h1>Promise element</h1>
      <Suspense fallback={<p>Loading</p>}>
        <Reveal content={card()} />
      </Suspense>
    </section>
  );
}
