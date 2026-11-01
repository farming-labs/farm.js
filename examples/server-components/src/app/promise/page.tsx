import { Quote } from "../../components/quote";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getQuote() {
  await wait(800);
  return { text: "Promises cross the wire", at: new Date("2026-10-31T00:00:00.000Z") };
}

export default function PromisePage() {
  return (
    <section>
      <h1>Promise</h1>
      <Quote quote={getQuote()} />
    </section>
  );
}
